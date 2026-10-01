import { prisma } from "@/lib/prisma";
import { fromBytes } from "@/lib/embed";
import { knnScore } from "@/lib/rank";
import { SinglesList } from "../components";

export const dynamic = "force-dynamic";

export default async function Rank() {
	const videos = await prisma.video.findMany({ where: { embedding: { not: null }, approval: { in: ["APPROVED", "UNRATED"] } } });
	const kept = videos.filter((v) => v.approval === "APPROVED").map((v) => fromBytes(v.embedding!));
	const ranked = videos
		.filter((v) => v.approval === "UNRATED")
		.map((v) => ({ ...v, score: knnScore(fromBytes(v.embedding!), kept) }))
		.sort((a, b) => b.score - a.score)
		.map(({ embedding: _, score, ...v }) => ({ ...v, note: score.toFixed(3) }));

	return (
		<section className="space-y-4">
			<h2 className="font-mono text-xl font-bold">RANKED <span className="text-muted-foreground text-sm">unrated videos by similarity to the {kept.length} you kept</span></h2>
			{ranked.length ? <SinglesList videos={ranked} /> : <p className="text-muted-foreground">Nothing to rank — unrated videos need transcripts and embeddings first.</p>}
		</section>
	);
}
