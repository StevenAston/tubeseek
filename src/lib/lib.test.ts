import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRange } from "./range.ts";
import { classifyUrl } from "./youtube.ts";
import { cleanTranscript, segmentsToEvents } from "./captions.ts";
import { chunk, dot, fromBytes, meanNormalize, toBytes } from "./embed.ts";

test("applyRange", () => {
	const v = ["a", "a", "a", "a", "a"];
	assert.deepEqual(applyRange(v, 3, 1, "b", false), ["a", "b", "a", "a", "a"]);
	assert.deepEqual(applyRange(v, 3, 1, "b", true), ["a", "b", "b", "b", "a"]);
	assert.deepEqual(applyRange(v, 1, 3, "b", true), ["a", "b", "b", "b", "a"]);
	assert.deepEqual(applyRange(v, null, 2, "b", true), ["a", "a", "b", "a", "a"]);
});

test("classifyUrl", () => {
	assert.deepEqual(classifyUrl("https://www.youtube.com/watch?v=abc&list=x"), { kind: "video", url: "https://www.youtube.com/watch?v=abc&list=x" });
	assert.equal(classifyUrl("youtu.be/abc").kind, "video");
	assert.equal(classifyUrl("https://www.youtube.com/shorts/abc").kind, "video");
	assert.equal(classifyUrl("youtube.com/@bigthink").url, "https://youtube.com/@bigthink/videos");
	assert.equal(classifyUrl("https://www.youtube.com/channel/UCx/").url, "https://www.youtube.com/channel/UCx/videos");
	assert.equal(classifyUrl("https://www.youtube.com/@bigthink/shorts").url, "https://www.youtube.com/@bigthink/shorts");
	assert.throws(() => classifyUrl("https://www.youtube.com/playlist?list=PL1"));
});

test("cleanTranscript drops sponsor-overlapping lines", () => {
	const ev = [
		{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "hello\n" }, { utf8: "world" }] },
		{ tStartMs: 2000, dDurationMs: 3000, segs: [{ utf8: "buy our sponsor" }] },
		{ tStartMs: 5000 }, // newline-only event, no segs
		{ tStartMs: 6000, dDurationMs: 1000, segs: [{ utf8: "back to it" }] },
	];
	assert.equal(cleanTranscript(ev, []), "hello world buy our sponsor back to it");
	assert.equal(cleanTranscript(ev, [[3, 4]]), "hello world back to it");
	assert.equal(cleanTranscript(ev, [[2, 2.5], [5.5, 6.2]]), "hello world");
});

test("Whisper segments go through the same sponsor cut", () => {
	const ev = segmentsToEvents([{ start: 0, end: 4, text: "intro" }, { start: 4, end: 9, text: "sponsor read" }, { start: 9, end: 12, text: "content" }]);
	assert.equal(cleanTranscript(ev, [[5, 8]]), "intro content");
});

test("embedding helpers", () => {
	const parts = chunk("aaaa bbbb cccc", 7);
	assert.deepEqual(parts, ["aaaa", "bbbb", "cccc"]); // splits on spaces, never mid-word
	assert.equal(parts.join(" "), "aaaa bbbb cccc");
	const v = meanNormalize([[1, 0], [0, 1]]);
	assert.ok(Math.abs(dot(v, v) - 1) < 1e-6); // unit length
	assert.deepEqual(fromBytes(toBytes(v)), v); // survives the SQLite round trip
});
