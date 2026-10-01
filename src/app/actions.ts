"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { classifyUrl, cookieArgs, ytDlpJson } from "@/lib/youtube";
import { NEEDS_CAPTIONS, cleanTranscript, fetchCaptions, pollWhisper, queueWhisper, segmentsToEvents, sponsorSegments } from "@/lib/captions";
import { embedVideo, toBytes } from "@/lib/embed";

export type Approval = "UNRATED" | "APPROVED" | "REJECTED";

// yt-dlp errors are a wall of stdout; the ERROR line is the useful bit
const errLine = (e: unknown) => e instanceof Error ? e.message.split("\n").find((l) => l.includes("ERROR")) ?? e.message : String(e);

async function log(level: "INFO" | "WARN" | "ERROR", message: string, youtubeId?: string) {
	console.log(`[${level}]${youtubeId ? ` ${youtubeId}` : ""} ${message}`);
	await prisma.log.create({ data: { level, message, youtubeId } });
}

async function ingestOne(raw: string) {
	const t = classifyUrl(raw);
	if (t.kind === "video") {
		const v = await ytDlpJson(t.url, ["--no-playlist"]);
		const data = { title: v.title, duration: v.duration ?? null, uploadDate: v.upload_date ?? null, channelTitle: v.channel ?? v.uploader ?? null };
		await prisma.video.upsert({ where: { youtubeId: v.id }, create: { youtubeId: v.id, isSingle: true, ...data }, update: { isSingle: true, ...data } });
		return;
	}
	const p = await ytDlpJson(t.url, ["--flat-playlist"]);
	const youtubeId: string = p.channel_id ?? p.id;
	const title: string = p.channel ?? p.uploader ?? p.title;
	const channel = await prisma.channel.upsert({
		where: { youtubeId },
		create: { youtubeId, title, url: `https://www.youtube.com/channel/${youtubeId}` },
		update: { title },
	});
	for (const e of p.entries ?? []) {
		// ponytail: one upsert per video, fine into the low thousands; batch in a transaction if it drags
		await prisma.video.upsert({
			where: { youtubeId: e.id },
			create: { youtubeId: e.id, title: e.title, duration: e.duration ?? null, channelTitle: title, channelId: channel.id },
			update: { channelId: channel.id },
		});
	}
}

export async function ingest(_prev: { errors: string[] }, form: FormData) {
	const urls = String(form.get("urls") ?? "").split(/\s+/).filter(Boolean);
	const errors: string[] = [];
	for (const url of urls) {
		try {
			await ingestOne(url);
			await log("INFO", `ingested ${url}`);
		} catch (e) {
			errors.push(`${url}: ${errLine(e)}`);
			await log("ERROR", `ingest ${url}: ${errLine(e)}`);
		}
	}
	revalidatePath("/");
	return { errors };
}

export async function setApproval(ids: string[], approval: Approval) {
	await prisma.video.updateMany({ where: { id: { in: ids } }, data: { approval } });
	revalidatePath("/", "layout"); // /rank too: a keep re-weights every score
}

export async function doAll(channelId: string) {
	await prisma.channel.update({ where: { id: channelId }, data: { approved: true } });
	await prisma.video.updateMany({ where: { channelId }, data: { approval: "APPROVED" } });
	revalidatePath("/");
}

// Checked → APPROVED. Unchecked go back to UNRATED (not REJECTED): skipping in refine isn't a dislike.
export async function approveChannel(channelId: string, ids: string[]) {
	await prisma.channel.update({ where: { id: channelId }, data: { approved: true } });
	await prisma.video.updateMany({ where: { channelId, id: { in: ids } }, data: { approval: "APPROVED" } });
	await prisma.video.updateMany({ where: { channelId, id: { notIn: ids }, approval: "APPROVED" }, data: { approval: "UNRATED" } });
	revalidatePath("/");
	redirect("/");
}

const BATCH = 20;

// ponytail: sequential, BATCH per click to stay clear of YouTube's 429s and request timeouts; background job if clicking gets old
export async function fetchTranscripts(_prev: { msg: string }, _form: FormData) {
	const todo = await prisma.video.findMany({ where: { transcriptSource: null, ...NEEDS_CAPTIONS }, orderBy: { approval: "asc" }, take: BATCH }); // "APPROVED" < "UNRATED"
	let got = 0, none = 0, failed = 0;
	await log("INFO", `transcript batch: ${todo.length} videos${cookieArgs().length ? " (with cookies)" : ""}`);
	for (const v of todo) {
		const t0 = Date.now();
		try {
			const events = await fetchCaptions(v.youtubeId);
			if (!events) {
				await prisma.video.update({ where: { id: v.id }, data: { transcriptSource: "NONE" } });
				await log("WARN", "no English captions", v.youtubeId);
				none++;
				continue;
			}
			const skip = await sponsorSegments(v.youtubeId);
			const transcript = cleanTranscript(events, skip);
			await prisma.video.update({ where: { id: v.id }, data: { transcript, transcriptSource: "CAPTIONS" } });
			await log("INFO", `captioned: ${transcript.length} chars, ${skip.length} sponsor segments cut, ${Date.now() - t0}ms`, v.youtubeId);
			got++;
		} catch (e) {
			await log("ERROR", errLine(e), v.youtubeId);
			failed++; // left null, retried next click
			if (String(e).includes("429")) break; // rate-limited: more requests only extend the block
		}
		await new Promise((r) => setTimeout(r, 4000)); // ponytail: fixed pacing; tune if 429s persist
	}
	const w = await whisperStep();
	const em = await embedStep();
	revalidatePath("/");
	const limited = failed && got + none + failed < todo.length;
	return { msg: `${got} captioned, ${none} without captions${failed ? `, ${failed} failed (will retry)` : ""}${limited ? " — YouTube rate-limited, try again in a few minutes" : ""}${w}${em}` };
}

// NONE → queued in paudio (WHISPER_PENDING) → polled each click until WHISPER, or FAILED if paudio errors
async function whisperStep() {
	const todo = await prisma.video.findMany({ where: { approval: "APPROVED", transcriptSource: { in: ["NONE", "WHISPER_PENDING"] } } });
	if (!todo.length) return "";
	let queued = 0, done = 0, waiting = 0;
	try {
		for (const v of todo) {
			if (v.transcriptSource === "NONE") {
				await queueWhisper(v.youtubeId);
				await prisma.video.update({ where: { id: v.id }, data: { transcriptSource: "WHISPER_PENDING" } });
				await log("INFO", "queued for Whisper in paudio", v.youtubeId);
				queued++;
				continue;
			}
			const r = await pollWhisper(v.youtubeId);
			if (r.status === "TRANSCRIBED") {
				const skip = await sponsorSegments(v.youtubeId);
				const transcript = cleanTranscript(segmentsToEvents(r.segments ?? []), skip);
				await prisma.video.update({ where: { id: v.id }, data: { transcript, transcriptSource: "WHISPER" } });
				await log("INFO", `whispered: ${transcript.length} chars, ${skip.length} sponsor segments cut`, v.youtubeId);
				done++;
			} else if (r.status === "UNKNOWN") {
				await prisma.video.update({ where: { id: v.id }, data: { transcriptSource: "NONE" } }); // paudio lost it; requeue next click
				await log("WARN", "paudio has no record, will requeue", v.youtubeId);
			} else if (r.status === "ERROR") {
				await prisma.video.update({ where: { id: v.id }, data: { transcriptSource: "FAILED" } });
				await log("ERROR", `Whisper failed in paudio: ${r.error ?? "unknown error"}`, v.youtubeId);
			} else waiting++;
		}
	} catch (e) {
		await log("WARN", `paudio unreachable: ${errLine(e)}`);
		return " — paudio unreachable, Whisper skipped";
	}
	return `; Whisper: ${queued} queued, ${done} done, ${waiting} in progress`;
}

// Every transcribed video without a vector; local GPU, so no batching or pacing needed
async function embedStep() {
	const todo = await prisma.video.findMany({ where: { transcript: { not: null }, embedding: null }, select: { id: true, youtubeId: true, title: true, transcript: true } });
	if (!todo.length) return "";
	let done = 0;
	try {
		for (const v of todo) {
			const t0 = Date.now();
			await prisma.video.update({ where: { id: v.id }, data: { embedding: toBytes(await embedVideo(v.title, v.transcript!)) } });
			await log("INFO", `embedded in ${Date.now() - t0}ms`, v.youtubeId);
			done++;
		}
	} catch (e) {
		await log("WARN", `Ollama unavailable: ${errLine(e)}`);
		return `; embedded ${done}, Ollama unavailable for the rest`;
	}
	return `; embedded ${done}`;
}
