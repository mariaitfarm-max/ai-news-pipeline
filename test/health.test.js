import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHealth, decideAlert } from "../scripts/lib/health.js";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const iso = (hAgo) => new Date(NOW - hAgo * 3600e3).toISOString();
const good = () => ({
  ok: true,
  news: { updated_at: iso(0.3), count: 100, feeds: { ok: 17, total: 18, failed: ["X"] }, ai: { enabled: true, attempted: 10, done: 9, model: "m" } },
  pricing: { updated_at: iso(5), count: 11 },
});

test("সব ঠিক থাকলে সমস্যা নেই", () => {
  assert.deepEqual(evaluateHealth(good(), NOW), []);
});

test("API বন্ধ", () => {
  assert.equal(evaluateHealth(null, NOW)[0].key, "api_down");
});

test("নিউজ পুরনো + দাম পুরনো", () => {
  const h = good();
  h.news.updated_at = iso(5);
  h.pricing.updated_at = iso(40);
  const keys = evaluateHealth(h, NOW).map((p) => p.key);
  assert.ok(keys.includes("news_stale") && keys.includes("pricing_stale"));
});

test("অর্ধেকের বেশি ফিড ফেল", () => {
  const h = good();
  h.news.feeds = { ok: 5, total: 18, failed: ["a", "b"] };
  assert.ok(evaluateHealth(h, NOW).some((p) => p.key === "feeds_failing"));
});

test("AI সব ফেল (কোটা ছাড়া) → সতর্কতা; কোটা হলে নয়", () => {
  const h = good();
  h.news.ai = { enabled: true, attempted: 8, done: 0, model: "m" };
  assert.ok(evaluateHealth(h, NOW).some((p) => p.key === "ai_failing"));
  h.news.ai.stopped = "quota";
  assert.ok(!evaluateHealth(h, NOW).some((p) => p.key === "ai_failing"));
});

test("পুরনো ফরম্যাটের health (feeds/ai নেই) ঠিক ধরা হয়", () => {
  const h = good();
  delete h.news.feeds;
  delete h.news.ai;
  assert.deepEqual(evaluateHealth(h, NOW), []);
});

test("decideAlert: একবারই পাঠায়, রিকভারিতে জানায়, ১২ ঘণ্টা পর রিমাইন্ডার", () => {
  const p = [{ key: "news_stale", text: "x" }];
  let r = decideAlert(p, null, NOW);
  assert.equal(r.send, "bad");
  r = decideAlert(p, r.next, NOW + 3600e3);
  assert.equal(r.send, null);
  r = decideAlert(p, r.next, NOW + 13 * 3600e3);
  assert.equal(r.send, "remind");
  const rec = decideAlert([], r.next, NOW + 14 * 3600e3);
  assert.equal(rec.send, "recovered");
  assert.equal(decideAlert([], rec.next, NOW + 15 * 3600e3).send, null);
});
