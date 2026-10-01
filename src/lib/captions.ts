import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cookieArgs } from "./youtube.ts";

const run = promisify(execFile);

// Kept videos, plus the unrated backlog of approved channels so /rank has candidates. Whisper stays kept-only (GPU minutes each).
export const NEEDS_CAPTIONS = { OR: [{ approval: "APPROVED" }, { approval: "UNRATED", channel: { approved: true } }] };

type Json3Event = { tStartMs?: number; dDurationMs?: number; segs?: { utf8: string }[] };
type Segment = [number, number]; // seconds

// Caption text minus anything overlapping a SponsorBlock segment.
export function cleanTranscript(events: Json3Event[], skip: Segment[]): string {
	return events
		.filter((e) => e.segs && !skip.some(([s, end]) => {
			const t = (e.tStartMs ?? 0) / 1000, d = (e.dDurationMs ?? 0) / 1000;
			return t < end && t + d > s;
		}))
		.map((e) => e.segs!.map((s) => s.utf8).join(""))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

export async function sponsorSegments(youtubeId: string): Promise<Segment[]> {
	const cats = encodeURIComponent(JSON.stringify(["sponsor", "selfpromo", "interaction"]));
	const res = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${youtubeId}&categories=${cats}`);
	if (res.status === 404) return []; // no segments submitted
	if (!res.ok) throw new Error(`SponsorBlock ${res.status}`);
	return (await res.json()).map((s: { segment: Segment }) => s.segment);
}

// Whisper fallback via paudio's /api/transcribe: POST queues (async, minutes on GPU), GET polls
const PAUDIO = process.env.PAUDIO_URL ?? "http://localhost:5600";
type WhisperStatus = { status: string; error?: string; segments?: { start: number; end: number; text: string }[] };

export async function queueWhisper(youtubeId: string): Promise<WhisperStatus> {
	const res = await fetch(`${PAUDIO}/api/transcribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ youtubeId }) });
	if (!res.ok) throw new Error(`paudio ${res.status}`);
	return res.json();
}

export async function pollWhisper(youtubeId: string): Promise<WhisperStatus> {
	const res = await fetch(`${PAUDIO}/api/transcribe?youtubeId=${youtubeId}`);
	if (!res.ok && res.status !== 404) throw new Error(`paudio ${res.status}`);
	return res.json();
}

// Whisper segments → json3-shaped events so cleanTranscript's sponsor cutting applies unchanged
export const segmentsToEvents = (segs: { start: number; end: number; text: string }[]): Json3Event[] =>
	segs.map((s) => ({ tStartMs: s.start * 1000, dDurationMs: (s.end - s.start) * 1000, segs: [{ utf8: s.text }] }));

// Manual captions win over auto when both exist. Returns null if the video has no English captions.
export async function fetchCaptions(youtubeId: string): Promise<Json3Event[] | null> {
	const dir = await mkdtemp(join(tmpdir(), "tubeseek-"));
	try {
		// "en" only: "en.*" also matches every auto-translated track and gets rate-limited (429)
		const err = await run("yt-dlp", [...cookieArgs(), "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en", "--sub-format", "json3",
			"-o", join(dir, "%(id)s"), `https://www.youtube.com/watch?v=${youtubeId}`]).then(() => null, (e: Error) => e);
		const file = (await readdir(dir)).find((f) => f.endsWith(".json3"));
		if (file) return JSON.parse(await readFile(join(dir, file), "utf8")).events; // partial failures still write files
		if (err) throw err; // e.g. 429 — not the same as "has no captions"
		return null;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
