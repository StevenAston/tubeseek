import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRange } from "./range.ts";
import { classifyUrl } from "./youtube.ts";

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
