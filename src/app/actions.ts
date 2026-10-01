"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { classifyUrl, ytDlpJson } from "@/lib/youtube";
import { errLine, log } from "@/lib/worker";

export type Approval = "UNRATED" | "APPROVED" | "REJECTED";

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
