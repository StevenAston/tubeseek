// Video → one vector: chunk the transcript, embed chunks with LM Studio, mean-pool, L2-normalise.
// Normalised vectors make cosine similarity a plain dot product.
// Picked over nomic (tighter, channel-bound clusters) and Qwen3 4B/8B (same quality, 4× slower) on this library.
const LMSTUDIO = process.env.LMSTUDIO_URL ?? "http://localhost:4545";
export const EMBED_MODEL = "text-embedding-qwen3-embedding-0.6b";
// ponytail: ~6000 tokens; load the model with --context-length 8192 or longer chunks get truncated
const CHUNK = 24000;

export function chunk(text: string, size = CHUNK): string[] {
	const out: string[] = [];
	for (let i = 0; i < text.length; ) {
		let end = Math.min(i + size, text.length);
		if (end < text.length) end = text.lastIndexOf(" ", end) > i ? text.lastIndexOf(" ", end) : end; // don't split words
		out.push(text.slice(i, end).trim());
		i = end;
	}
	return out.filter(Boolean);
}

export function meanNormalize(vecs: number[][]): Float32Array<ArrayBuffer> {
	const m = new Float32Array(vecs[0].length);
	for (const v of vecs) v.forEach((x, i) => (m[i] += x));
	const n = Math.hypot(...m) || 1;
	return m.map((x) => x / n);
}

export const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);

// SQLite Bytes ↔ Float32Array
export const toBytes = (v: Float32Array<ArrayBuffer>) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const fromBytes = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

// Qwen3 takes documents bare (only queries get an instruction); title leads so short transcripts still carry the topic
export async function embedVideo(title: string, transcript: string): Promise<Float32Array<ArrayBuffer>> {
	const input = chunk(`${title}. ${transcript}`);
	const res = await fetch(`${LMSTUDIO}/v1/embeddings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: EMBED_MODEL, input }) });
	if (!res.ok) throw new Error(`LM Studio ${res.status}: ${await res.text()}`);
	return meanNormalize((await res.json()).data.map((d: { embedding: number[] }) => d.embedding));
}
