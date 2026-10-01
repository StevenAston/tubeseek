import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = { ERROR: "bg-primary text-primary-foreground", WARN: "bg-secondary text-secondary-foreground", INFO: "bg-card" };

export default async function LogPage() {
	const rows = await prisma.log.findMany({ orderBy: { id: "desc" }, take: 200 });
	return (
		<section className="space-y-4">
			<h2 className="font-mono text-xl font-bold">LOG <span className="text-muted-foreground text-sm">latest 200</span></h2>
			{!rows.length && <p className="text-muted-foreground">Nothing logged yet.</p>}
			<ul className="box divide-y-2 divide-border font-mono text-sm">
				{rows.map((r) => (
					<li key={r.id} className="flex gap-3 p-2 items-baseline">
						<span className="text-muted-foreground shrink-0">{r.createdAt.toLocaleString()}</span>
						<span className={`border-2 border-border px-1 text-xs font-bold shrink-0 ${COLOR[r.level]}`}>{r.level}</span>
						{r.youtubeId && <a href={`https://www.youtube.com/watch?v=${r.youtubeId}`} target="_blank" rel="noreferrer" className="underline shrink-0">{r.youtubeId}</a>}
						<span className="break-all">{r.message}</span>
					</li>
				))}
			</ul>
		</section>
	);
}
