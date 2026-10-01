import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function ytDlpJson(url: string, extraArgs: string[] = []) {
	// ponytail: synchronous, a 2k-video channel takes ~30s; move to a job queue if that hurts
	const { stdout } = await run("yt-dlp", ["-J", ...extraArgs, url], { maxBuffer: 512 * 1024 * 1024 });
	return JSON.parse(stdout);
}

export type Target = { kind: "video" | "channel"; url: string };

export function classifyUrl(raw: string): Target {
	const u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
	if (u.hostname === "youtu.be" || u.searchParams.has("v") || /^\/(shorts|live|embed)\/[^/]+/.test(u.pathname)) {
		return { kind: "video", url: u.toString() };
	}
	if (u.pathname.startsWith("/playlist")) throw new Error(`playlists not supported: ${raw}`);
	// A channel root returns a playlist of tabs, not videos — point it at the uploads tab
	const root = u.pathname.match(/^\/(@[^/]+|(channel|c|user)\/[^/]+)\/?$/);
	if (root) u.pathname = `/${root[1]}/videos`;
	return { kind: "channel", url: u.toString() };
}
