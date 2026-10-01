import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RefineList } from "../../components";

export const dynamic = "force-dynamic";

export default async function Refine({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const channel = await prisma.channel.findUnique({ where: { id }, include: { videos: { orderBy: { createdAt: "asc" } } } });
	if (!channel) notFound();
	return (
		<section className="space-y-4">
			<h1 className="font-mono text-2xl font-bold">{channel.title}</h1>
			<RefineList channelId={channel.id} videos={channel.videos} />
		</section>
	);
}
