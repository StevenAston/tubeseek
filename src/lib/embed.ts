// Video → one vector: chunk the transcript, embed chunks with Ollama, mean-pool, L2-normalise.
// Normalised vectors make cosine similarity a plain dot product.
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const EMBED_MODEL = "nomic-embed-text";
// ponytail: ~1000 tokens, safely under Ollama's default 2048 num_ctx for this model (it truncates silently past that)
const CHUNK = 4000;

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

// nomic-embed-text wants a task prefix; title leads so short transcripts still carry the topic
export async function embedVideo(title: string, transcript: string): Promise<Float32Array<ArrayBuffer>> {
	const input = chunk(`${title}. ${transcript}`).map((c) => `search_document: ${c}`);
	const res = await fetch(`${OLLAMA}/api/embed`, { method: "POST", body: JSON.stringify({ model: EMBED_MODEL, input }) });
	if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
	return meanNormalize((await res.json()).embeddings);
}
