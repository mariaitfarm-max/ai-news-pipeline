import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { selectRunsToDelete } from "../scripts/cleanup.js";

function env(data) {
  return { AINEWS: { get: async (k) => (k in data ? data[k] : null) } };
}
const req = (p, method = "GET") => new Request("https://x.workers.dev" + p, { method });

test("/api/news: ডেটা থাকলে 200, CORS নেই", async () => {
  const res = await worker.fetch(req("/api/news"), env({ news: '{"status":"ok","articles":[]}' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("/api/news: ডেটা না থাকলে 503", async () => {
  const res = await worker.fetch(req("/api/news"), env({}));
  assert.equal(res.status, 503);
});

test("/health: news_meta থেকে পড়ে", async () => {
  const meta = JSON.stringify({ generatedAt: "2026-11-06T10:00:00Z", totalResults: 50, feedStats: { ok: 3, total: 4, failed: ["a"] }, ai: { done: 2 } });
  const res = await worker.fetch(req("/health"), env({ news_meta: meta, pricing: '{"last_updated":"2026-11-06T01:00:00Z","model_count":11}' }));
  const j = await res.json();
  assert.equal(j.news.count, 50);
  assert.equal(j.news.feeds.ok, 3);
  assert.equal(j.pricing.count, 11);
});

test("/health: news_meta না থাকলে news-এ ফল-ব্যাক", async () => {
  const res = await worker.fetch(req("/health"), env({ news: '{"generatedAt":"2026-11-06T10:00:00Z","totalResults":9}' }));
  assert.equal((await res.json()).news.count, 9);
});

test("POST নিষিদ্ধ, অজানা পাথ 404", async () => {
  assert.equal((await worker.fetch(req("/api/news", "POST"), env({}))).status, 405);
  assert.equal((await worker.fetch(req("/nope"), env({}))).status, 404);
});

test("cleanup: শুধু পুরনো সম্পন্ন রান বাছে", () => {
  const cutoff = Date.parse("2026-11-01T00:00:00Z");
  const runs = [
    { id: 1, status: "completed", created_at: "2026-10-20T00:00:00Z" },
    { id: 2, status: "in_progress", created_at: "2026-10-20T00:00:00Z" },
    { id: 3, status: "completed", created_at: "2026-11-05T00:00:00Z" },
  ];
  assert.deepEqual(selectRunsToDelete(runs, cutoff), [1]);
});
