"use client";

import { useActionState, useState, useTransition } from "react";
import { applyRange } from "@/lib/range";
import { approveChannel, ingest, setApproval, type Approval } from "./actions";

export type VideoRowData = { id: string; youtubeId: string; title: string; channelTitle: string | null; duration: number | null; approval: string; note?: string };

function fmt(s: number | null) {
	if (s == null) return "";
	const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(Math.floor(s % 60)).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function VideoInfo({ v }: { v: VideoRowData }) {
	return (
		<>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={`https://i.ytimg.com/vi/${v.youtubeId}/mqdefault.jpg`} alt="" loading="lazy" className="w-32 aspect-video object-cover border-2 border-border shrink-0" />
			<div className="min-w-0 flex-1">
				<a href={`https://www.youtube.com/watch?v=${v.youtubeId}`} target="_blank" rel="noreferrer" className="font-bold hover:underline line-clamp-2">{v.title}</a>
				<div className="font-mono text-xs text-muted-foreground">{v.channelTitle} {fmt(v.duration) && `· ${fmt(v.duration)}`} {v.note && `· ${v.note}`}</div>
			</div>
		</>
	);
}

export function IngestForm() {
	const [state, action, pending] = useActionState(ingest, { errors: [] });
	return (
		<form action={action} className="box p-4 space-y-3">
			<textarea name="urls" rows={4} required placeholder="Paste YouTube video or channel URLs, one per line"
				className="w-full border-2 border-border bg-background p-2 font-mono text-sm" />
			<button className="btn bg-primary text-primary-foreground" disabled={pending}>{pending ? "Ingesting…" : "Ingest"}</button>
			{state.errors.map((e) => <p key={e} className="font-mono text-sm text-primary">{e}</p>)}
		</form>
	);
}

const CHOICES: [Approval, string][] = [["APPROVED", "Keep"], ["REJECTED", "Skip"]];

export function SinglesList({ videos }: { videos: VideoRowData[] }) {
	const [vals, setVals] = useState(videos.map((v) => v.approval));
	const [anchor, setAnchor] = useState<number | null>(null);
	const [, start] = useTransition();
	// Server re-renders after revalidate; resync when the list itself changes
	const [prev, setPrev] = useState(videos);
	if (prev !== videos) { setPrev(videos); setVals(videos.map((v) => v.approval)); }

	function pick(i: number, value: Approval, shift: boolean) {
		const next = applyRange(vals, anchor, i, value, shift);
		const ids = videos.filter((_, j) => next[j] !== vals[j]).map((v) => v.id);
		setVals(next);
		setAnchor(i);
		if (ids.length) start(() => setApproval(ids, value));
	}

	return (
		<ul className="space-y-3">
			{videos.map((v, i) => (
				<li key={v.id} className="box p-3 flex items-center gap-4">
					<VideoInfo v={v} />
					<div className="flex gap-2 shrink-0 select-none">
						{CHOICES.map(([value, label]) => (
							<label key={value} className={`btn text-xs ${vals[i] === value ? (value === "APPROVED" ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground") : "bg-card"}`}>
								<input type="radio" className="sr-only" name={`a-${v.id}`} checked={vals[i] === value} onChange={() => {}}
									onClick={(e) => pick(i, value, e.shiftKey)} />
								{label}
							</label>
						))}
					</div>
				</li>
			))}
		</ul>
	);
}

export function RefineList({ channelId, videos }: { channelId: string; videos: VideoRowData[] }) {
	const [checked, setChecked] = useState(videos.map((v) => v.approval === "APPROVED"));
	const [anchor, setAnchor] = useState<number | null>(null);
	const [pending, start] = useTransition();
	const all = checked.every(Boolean);
	const count = checked.filter(Boolean).length;

	return (
		<div className="space-y-4">
			<div className="box p-3 flex items-center gap-4 sticky top-2 z-10">
				<button className="btn bg-secondary text-secondary-foreground" onClick={() => setChecked(checked.map(() => !all))}>{all ? "Select none" : "Select all"}</button>
				<span className="font-mono flex-1">{count} / {videos.length} selected</span>
				<button className="btn bg-accent text-accent-foreground" disabled={pending}
					onClick={() => start(() => approveChannel(channelId, videos.filter((_, i) => checked[i]).map((v) => v.id)))}>
					{pending ? "Saving…" : "Approve channel"}
				</button>
			</div>
			<ul className="space-y-2">
				{videos.map((v, i) => (
					<li key={v.id}>
						<label className={`box p-2 flex items-center gap-4 cursor-pointer select-none ${checked[i] ? "bg-secondary text-secondary-foreground" : ""}`}>
							<input type="checkbox" className="size-5 accent-black shrink-0" checked={checked[i]} onChange={() => {}}
								onClick={(e) => { setChecked(applyRange(checked, anchor, i, !checked[i], e.shiftKey)); setAnchor(i); }} />
							<VideoInfo v={v} />
						</label>
					</li>
				))}
			</ul>
		</div>
	);
}
