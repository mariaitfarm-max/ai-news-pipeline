// Cloudflare Worker: KV-তে রাখা ডেটা অ্যাপকে দেয় + নিজের Cron দিয়ে GitHub workflow চালু করে ও পাহারা দেয়।
//   GET /api/news              -> নিউজ ফিড
//   GET /api/model-pricing     -> মডেল দাম/বেঞ্চমার্ক
//   GET /health                -> সার্ভিস ঠিক আছে কিনা + ডেটা কতটা নতুন (সবসময় 200)
//   GET /health?strict=1       -> ডেটা পুরনো/ফিড ফেল হলে 503 (UptimeRobot-এর জন্য)
//   scheduled (Cron Trigger)   -> GitHub Actions-এর workflow_dispatch + সমস্যা হলে Telegram
//
// Secrets (Cloudflare ড্যাশবোর্ড → Worker → Settings → Variables and Secrets, টাইপ "Secret"):
//   GH_DISPATCH_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Vars (wrangler.toml, cf-setup.js লেখে): GH_REPO, GH_REF

import { evaluateHealth, decideAlert } from "../../scripts/lib/health.js";

const PRICING_CRON = "23 3,15 * * *"; // cf-setup.js-এর crons-এর সাথে মিল থাকতে হবে

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...JSON_HEADERS, ...extra } });
}

async function serveKey(env, key) {
  const body = await env.AINEWS.get(key, { cacheTtl: 300 });
  if (body === null) {
    return json({ error: "data_not_ready", message: "ডেটা এখনো তৈরি হয়নি — GitHub Actions workflow চালাও" }, 503, {
      "cache-control": "no-store",
    });
  }
  return new Response(body, {
    status: 200,
    headers: { ...JSON_HEADERS, "cache-control": "public, max-age=300" },
  });
}

async function summary(env, keys, stampField, countField) {
  let body = null;
  for (const key of keys) {
    body = await env.AINEWS.get(key, { cacheTtl: 60 });
    if (body !== null) break;
  }
  if (body === null) return null;
  try {
    const o = JSON.parse(body);
    return {
      updated_at: o[stampField] || null,
      count: o[countField] ?? null,
      feeds: o.feedStats ?? null,
      ai: o.ai ?? null,
    };
  } catch {
    return { updated_at: null, count: null, feeds: null, ai: null };
  }
}

async function buildHealth(env) {
  const [news, pricing] = await Promise.all([
    summary(env, ["news_meta", "news"], "generatedAt", "totalResults"),
    summary(env, ["pricing"], "last_updated", "model_count"),
  ]);
  return { ok: true, news, pricing };
}

// ---------- Cron: GitHub workflow চালু করা ----------

async function dispatchWorkflow(env, workflowFile) {
  if (!env.GH_REPO || !env.GH_DISPATCH_TOKEN) return { ok: false, reason: "টোকেন/রিপো সেট নেই" };
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${workflowFile}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ainews-worker-cron",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: env.GH_REF || "main" }),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.status === 204, status: res.status };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: String(text).slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function runScheduled(event, env) {
  const workflow = event.cron === PRICING_CRON ? "update-model-pricing.yml" : "update-news.yml";
  const d = await dispatchWorkflow(env, workflow);

  const problems = [];
  if (!d.ok) {
    problems.push({
      key: "dispatch_failed",
      text: `GitHub workflow চালু করা গেল না (${workflow}, ${d.status ? "HTTP " + d.status : d.reason}) — GH_DISPATCH_TOKEN-এর মেয়াদ/অনুমতি দেখো`,
    });
  }
  problems.push(...evaluateHealth(await buildHealth(env)));

  let state = null;
  try {
    const raw = await env.AINEWS.get("alert_state");
    state = raw ? JSON.parse(raw) : null;
  } catch {
    state = null;
  }
  const { send, next } = decideAlert(problems, state);
  if (send) {
    const list = problems.map((p) => "• " + p.text).join("\n");
    const msg =
      send === "recovered"
        ? "✅ AI News ব্যাকএন্ড আবার ঠিক হয়েছে"
        : `${send === "remind" ? "⏰ (রিমাইন্ডার) " : "🚨 "}AI News ব্যাকএন্ডে সমস্যা:\n${list}`;
    await sendTelegram(env, msg);
  }
  if (!state || state.sig !== next.sig || state.notifiedAt !== next.notifiedAt) {
    try {
      await env.AINEWS.put("alert_state", JSON.stringify(next));
    } catch {
      /* পরের রানে আবার চেষ্টা */
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/api/news":
        return serveKey(env, "news");
      case "/api/model-pricing":
        return serveKey(env, "pricing");
      case "/health": {
        const health = await buildHealth(env);
        if (url.searchParams.get("strict") === "1") {
          const problems = evaluateHealth(health);
          if (problems.length) {
            return json({ ...health, ok: false, problems: problems.map((p) => p.text) }, 503, { "cache-control": "no-store" });
          }
        }
        return json(health, 200, { "cache-control": "no-store" });
      }
      case "/":
        return new Response("AI News API", { headers: { "content-type": "text/plain; charset=utf-8" } });
      default:
        return json({ error: "not_found" }, 404);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event, env));
  },
};
