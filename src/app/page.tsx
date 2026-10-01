import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { doAll } from "./actions";
import { IngestForm, SinglesList } from "./components";

export const dynamic = "force-dynamic";

export default async function Home() {
	const singles = await prisma.video.findMany({ where: { isSingle: true }, orderBy: { createdAt: "desc" } });
	const channels = await prisma.channel.findMany({
		orderBy: { createdAt: "desc" },
		include: { _count: { select: { videos: true } }, videos: { where: { approval: "APPROVED" }, select: { id: true } } },
	});

	return (
		<>
			<IngestForm />

			<section className="space-y-4">
				<h2 className="font-mono text-xl font-bold">VIDEOS <span className="text-muted-foreground text-sm">shift-click to apply to a run</span></h2>
				{singles.length ? <SinglesList videos={singles} /> : <p className="text-muted-foreground">No single videos yet.</p>}
			</section>

			<section className="space-y-4">
				<h2 className="font-mono text-xl font-bold">CHANNELS</h2>
				{!channels.length && <p className="text-muted-foreground">No channels yet.</p>}
				<ul className="space-y-3">
					{channels.map((c) => (
						<li key={c.id} className={`box p-4 flex items-center gap-4 ${c.approved ? "bg-muted" : ""}`}>
							<div className="flex-1 min-w-0">
								<a href={c.url} target="_blank" rel="noreferrer" className="font-bold text-lg hover:underline">{c.title}</a>
								<div className="font-mono text-xs text-muted-foreground">{c.videos.length} / {c._count.videos} approved</div>
							</div>
							<form action={doAll.bind(null, c.id)}>
								<button className="btn bg-accent text-accent-foreground">Do all</button>
							</form>
							<Link href={`/channel/${c.id}`} className="btn bg-secondary text-secondary-foreground">Refine</Link>
						</li>
					))}
				</ul>
			</section>
		</>
	);
}
