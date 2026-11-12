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

// ---------- Cron (scheduled) ----------
function kvEnv(data, extra = {}) {
  const store = { ...data };
  return {
    store,
    env: {
      AINEWS: {
        get: async (k) => (k in store ? store[k] : null),
        put: async (k, v) => {
          store[k] = v;
        },
      },
      GH_REPO: "owner/repo",
      GH_REF: "main",
      GH_DISPATCH_TOKEN: "ghp_test",
      TELEGRAM_BOT_TOKEN: "tg_token",
      TELEGRAM_CHAT_ID: "123",
      ...extra,
    },
  };
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
function healthyData() {
  return {
    news_meta: JSON.stringify({ generatedAt: hoursAgo(0.2), totalResults: 100, feedStats: { ok: 17, total: 18, failed: ["X"] }, ai: { enabled: true, attempted: 10, done: 9 } }),
    pricing: JSON.stringify({ last_updated: hoursAgo(5), model_count: 30 }),
  };
}
async function runCron(env, cron, ghStatus = 204) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("api.github.com")) return new Response(null, { status: ghStatus });
    return new Response("{}", { status: 200 });
  };
  const pending = [];
  try {
    await worker.scheduled({ cron }, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

test("cron: সব ঠিক থাকলে শুধু update-news dispatch, Telegram নয়", async () => {
  const { env } = kvEnv(healthyData());
  const calls = await runCron(env, "2,32 * * * *");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/repos/owner/repo/actions/workflows/update-news.yml/dispatches"));
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).ref, "main");
  assert.equal(calls[0].init.headers.Authorization, "Bearer ghp_test");
});

test("cron: দামের cron-এ update-model-pricing.yml চালু হয়", async () => {
  const { env } = kvEnv(healthyData());
  const calls = await runCron(env, "23 3,15 * * *");
  assert.ok(calls[0].url.includes("update-model-pricing.yml"));
});

test("cron: খবর পুরনো হলে একবারই Telegram, পরের রানে নয়, ঠিক হলে 'ঠিক হয়েছে'", async () => {
  const data = healthyData();
  data.news_meta = JSON.stringify({ generatedAt: hoursAgo(5), totalResults: 100 });
  const { env, store } = kvEnv(data);
  let calls = await runCron(env, "2,32 * * * *");
  const tg1 = calls.filter((c) => c.url.includes("api.telegram.org"));
  assert.equal(tg1.length, 1);
  assert.ok(JSON.parse(tg1[0].init.body).text.includes("পুরনো"));
  assert.ok(JSON.parse(store.alert_state).sig.includes("news_stale"));

  calls = await runCron(env, "2,32 * * * *");
  assert.equal(calls.filter((c) => c.url.includes("api.telegram.org")).length, 0);

  store.news_meta = healthyData().news_meta;
  calls = await runCron(env, "2,32 * * * *");
  const tg3 = calls.filter((c) => c.url.includes("api.telegram.org"));
  assert.equal(tg3.length, 1);
  assert.ok(JSON.parse(tg3[0].init.body).text.includes("ঠিক হয়েছে"));
});

test("cron: GitHub 401 দিলে dispatch_failed অ্যালার্ট", async () => {
  const { env } = kvEnv(healthyData());
  const calls = await runCron(env, "2,32 * * * *", 401);
  const tg = calls.filter((c) => c.url.includes("api.telegram.org"));
  assert.equal(tg.length, 1);
  assert.ok(JSON.parse(tg[0].init.body).text.includes("HTTP 401"));
});

test("cron: টোকেন না থাকলে fetch ছাড়াই অ্যালার্ট-স্টেট, ক্র্যাশ নয়", async () => {
  const { env } = kvEnv(healthyData(), { GH_DISPATCH_TOKEN: undefined, TELEGRAM_BOT_TOKEN: undefined });
  const calls = await runCron(env, "2,32 * * * *");
  assert.equal(calls.length, 0);
});

test("/health?strict=1: ঠিক থাকলে 200, পুরনো হলে 503", async () => {
  const ok = await worker.fetch(req("/health?strict=1"), kvEnv(healthyData()).env);
  assert.equal(ok.status, 200);
  const stale = healthyData();
  stale.news_meta = JSON.stringify({ generatedAt: hoursAgo(6), totalResults: 100 });
  const bad = await worker.fetch(req("/health?strict=1"), kvEnv(stale).env);
  assert.equal(bad.status, 503);
  const j = await bad.json();
  assert.equal(j.ok, false);
  assert.ok(j.problems[0].includes("পুরনো"));
  const plain = await worker.fetch(req("/health"), kvEnv(stale).env);
  assert.equal(plain.status, 200);
});
