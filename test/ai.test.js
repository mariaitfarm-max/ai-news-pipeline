import test from "node:test";
import assert from "node:assert/strict";
import { parseAi, createSummarizer, isModelGone, isQuotaError, isAuthError } from "../scripts/lib/ai.js";

const GOOD =
  "SUMMARY: OpenAI released a new model today and said it improves reasoning for developers worldwide.\nPOINTS:\n- New model released today\n- Focus on reasoning quality for developers";

test("parseAi: সামারি + পয়েন্ট", () => {
  const r = parseAi(GOOD);
  assert.ok(r.summary.startsWith("OpenAI released"));
  assert.equal(r.points.length, 2);
});

test("parseAi: খারাপ/ছোট আউটপুটে null", () => {
  assert.equal(parseAi("ok"), null);
  assert.equal(parseAi(null), null);
});

test("এরর শ্রেণিবিন্যাস", () => {
  assert.ok(isModelGone(new Error("Cloudflare API POST ... -> 400 5028: model deprecated")));
  assert.ok(isQuotaError(new Error("3036: you have used up your daily free allocation of 10,000 neurons")));
  assert.ok(isAuthError(new Error("403 Forbidden")));
  assert.ok(!isModelGone(new Error("timeout")));
});

test("createSummarizer: বন্ধ মডেল ছেড়ে পরেরটায় যায়", async () => {
  const calls = [];
  const run = async (model) => {
    calls.push(model);
    if (model === "A") throw new Error("5028: model deprecated");
    return GOOD;
  };
  const s = createSummarizer(["A", "B"], run);
  const r = await s.summarize("t", "x".repeat(200));
  assert.ok(r.summary);
  assert.deepEqual(s.stats.skipped, ["A"]);
  assert.equal(s.stats.model, "B");
  await s.summarize("t2", "y".repeat(200));
  assert.deepEqual(calls, ["A", "B", "B"]); // A আর চেষ্টা হয়নি
});

test("createSummarizer: সব মডেল বন্ধ হলে ত্রুটি", async () => {
  const run = async () => {
    throw new Error("5028: model deprecated");
  };
  const s = createSummarizer(["A", "B"], run);
  await assert.rejects(() => s.summarize("t", "x".repeat(200)));
});

test("createSummarizer: কোটা-ত্রুটিতে মডেল বদলায় না", async () => {
  const calls = [];
  const run = async (m) => {
    calls.push(m);
    throw new Error("429 rate limit");
  };
  const s = createSummarizer(["A", "B"], run);
  await assert.rejects(() => s.summarize("t", "x".repeat(200)));
  assert.deepEqual(calls, ["A"]);
});
