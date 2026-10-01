// Background pipeline. Each video's columns are its queue position, so a restart loses nothing:
//   captions:  transcriptSource null           → CAPTIONS | NONE         (YouTube-bound, paced)
//   whisper:   NONE → WHISPER_PENDING          → WHISPER | FAILED       (paudio's GPU)
//   embedding: transcript set, embedding null  → embedding              (LM Studio's GPU, paused while Whisper runs)
import { prisma } from "./prisma";
import { cookieArgs } from "./youtube";
import { NEEDS_CAPTIONS, cleanTranscript, fetchCaptions, pollWhisper, queueWhisper, segmentsToEvents, sponsorSegments } from "./captions";
import { embedVideo, toBytes } from "./embed";

const CAPTION_GAP = 12_000; // ~300 videos/hour, well under YouTube's 429 threshold
const RATE_LIMITED = 15 * 60_000; // a 429 means back off; retrying sooner only extends the block
const GPU_TICK = 30_000; // Whisper poll interval, and the wait while paused or idle
const IDLE = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// yt-dlp errors are a wall of stdout; the ERROR line is the useful bit
export const errLine = (e: unknown) => e instanceof Error ? e.message.split("\n").find((l) => l.includes("ERROR")) ?? e.message : String(e);

export async function log(level: "INFO" | "WARN" | "ERROR", message: string, youtubeId?: string) {
	console.log(`[${level}]${youtubeId ? ` ${youtubeId}` : ""} ${message}`);
	await prisma.log.create({ data: { level, message, youtubeId } });
}

// A down service would otherwise log the same WARN every tick
const lastWarn: Record<string, string> = {};
async function warnOnce(key: string, message?: string) {
	if (message && lastWarn[key] !== message) await log("WARN", message);
	if (message) lastWarn[key] = message;
	else delete lastWarn[key];
}

export const queueCounts = async () => ({
	captions: await prisma.video.count({ where: { transcriptSource: null, ...NEEDS_CAPTIONS } }),
	whisper: await prisma.video.count({ where: { approval: "APPROVED", transcriptSource: { in: ["NONE", "WHISPER_PENDING"] } } }),
	embedding: await prisma.video.count({ where: { transcript: { not: null }, embedding: null } }),
});

// Returns true if YouTube rate-limited us
async function captionOne(v: { id: string; youtubeId: string }): Promise<boolean> {
	const t0 = Date.now();
	try {
		const events = await fetchCaptions(v.youtubeId);
		if (!events) {
			await prisma.video.update({ where: { id: v.id }, data: { transcriptSource: "NONE" } });
			await log("WARN", "no English captions", v.youtubeId);
			return false;
		}
		const skip = await sponsorSegments(v.youtubeId);
		const transcript = cleanTranscript(events, skip);
		await prisma.video.update({ where: { id: v.id }, data: { transcript, transcriptSource: "CAPTIONS" } });
		await log("INFO", `captioned: ${transcript.length} chars, ${skip.length} sponsor segments cut, ${Date.now() - t0}ms`, v.youtubeId);
	} catch (e) {
		await log("ERROR", errLine(e), v.youtubeId); // left null, retried next pass
		return String(e).includes("429");
	}
	return false;
}

async function captionLoop() {
	await log("INFO", `caption worker started${cookieArgs().length ? " (with cookies)" : ""}`);
	for (;;) {
		try {
			const v = await prisma.video.findFirst({ where: { transcriptSource: null, ...NEEDS_CAPTIONS }, orderBy: { approval: "asc" } }); // "APPROVED" < "UNRATED"
			if (!v) { await sleep(IDLE); continue; }
			if (await captionOne(v)) {
				await log("WARN", `YouTube rate-limited, pausing captions ${RATE_LIMITED / 60_000} min`);
				await sleep(RATE_LIMITED);
			} else await sleep(CAPTION_GAP);
		} catch (e) {
			await warnOnce("captions", `caption worker: ${errLine(e)}`);
			await sleep(IDLE);
		}
	}
}

// Queue new Whisper jobs in paudio and collect finished ones. Whisper stays kept-only (GPU minutes each).
async function whisperStep() {
	const todo = await prisma.video.findMany({ where: { approval: "APPROVED", transcriptSource: { in: ["NONE", "WHISPER_PENDING"] } } });
	try {
		for (const v of todo) {
			if (v.transcriptSource === "NONE") {
				await queueWhisper(v.youtubeId);
				await prisma.video.update({ where: { id: v.id }, data: { transcriptSource: "WHISPER_PENDING" } });
				await log("INFO", "queued for Whisper in paudio", v.youtubeId);
				continue;
			}
			const r = await pollWhisper(v.youtubeId);
			if (r.status === "TRANSCRIBED") {
				const skip = await sponsorSegments(v.youtubeId);
				const transcript = cleanTranscript(segmentsToEvents(r.segments ?? []), skip);
				await prisma.video.update({ where: { id: v.id }, data: { transcript, transcriptSource: "WHISPER" } });
				await log("INFO", `whispered: ${transcript.length} chars, ${skip.length} sponsor segments cut`, v.youtubeId);
			} else if (r.status === "UNKNOWN") {
				await prisma.video.update({ where: { id: v.id }, data: { transcriptSource: "NONE" } }); // paudio lost it; requeue next tick
				await log("WARN", "paudio has no record, will requeue", v.youtubeId);
			} else if (r.status === "ERROR") {
				await prisma.video.update({ where: { id: v.id }, data: { transcriptSource: "FAILED" } });
				await log("ERROR", `Whisper failed in paudio: ${r.error ?? "unknown error"}`, v.youtubeId);
			}
		}
		await warnOnce("paudio");
	} catch (e) {
		await warnOnce("paudio", `paudio unreachable: ${errLine(e)}`);
	}
}

// ponytail: only sees Whisper jobs tubeseek queued; paudio work started by hand doesn't pause embedding
async function gpuLoop() {
	for (;;) {
		try {
			await whisperStep();
			const whisperBusy = await prisma.video.count({ where: { transcriptSource: "WHISPER_PENDING" } });
			const v = whisperBusy ? null : await prisma.video.findFirst({ where: { transcript: { not: null }, embedding: null }, select: { id: true, youtubeId: true, title: true, transcript: true } });
			if (v) {
				const t0 = Date.now();
				await prisma.video.update({ where: { id: v.id }, data: { embedding: toBytes(await embedVideo(v.title, v.transcript!)) } });
				await log("INFO", `embedded in ${Date.now() - t0}ms`, v.youtubeId);
				await warnOnce("embed");
				continue; // straight to the next one, re-checking Whisper first
			}
		} catch (e) {
			await warnOnce("embed", `LM Studio unavailable: ${errLine(e)}`);
		}
		await sleep(GPU_TICK);
	}
}

export function startWorker() {
	const g = globalThis as { tubeseekWorker?: boolean };
	if (g.tubeseekWorker) return; // ponytail: dev hot reload keeps the old loops running old code; restart the server after editing this file
	g.tubeseekWorker = true;
	void captionLoop();
	void gpuLoop();
}
