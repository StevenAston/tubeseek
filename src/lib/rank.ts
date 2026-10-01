import { dot } from "./embed.ts";

// Mean similarity to the k nearest kept videos. kNN over a centroid: taste is multimodal
// (Romans and Welsh folklore), and a centroid averages them into something matching neither.
// ponytail: brute force O(candidates × kept), fine into the tens of thousands; vector index past that
// ponytail: REJECTED videos have no transcripts yet, so no negative term; subtract their kNN score once they do
export function knnScore(v: Float32Array, kept: Float32Array[], k = 5): number {
	const sims = kept.map((p) => dot(v, p)).sort((a, b) => b - a).slice(0, k);
	return sims.length ? sims.reduce((s, x) => s + x, 0) / sims.length : 0;
}
