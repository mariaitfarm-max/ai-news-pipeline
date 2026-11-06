// Cloudflare Worker: KV-তে রাখা ডেটা অ্যাপকে দেয়।
//   GET /api/news           -> NewsAPI-সামঞ্জস্যপূর্ণ ফিড
//   GET /api/model-pricing  -> মডেল দাম/বেঞ্চমার্ক
//   GET /health             -> সার্ভিস ঠিক আছে কিনা + ডেটা কতটা নতুন

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

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case "/api/news":
        return serveKey(env, "news");
      case "/api/model-pricing":
        return serveKey(env, "pricing");
      case "/health": {
        const [news, pricing] = await Promise.all([
          summary(env, ["news_meta", "news"], "generatedAt", "totalResults"),
          summary(env, ["pricing"], "last_updated", "model_count"),
        ]);
        return json({ ok: true, news, pricing }, 200, { "cache-control": "no-store" });
      }
      case "/":
        return new Response("AI News API", { headers: { "content-type": "text/plain; charset=utf-8" } });
      default:
        return json({ error: "not_found" }, 404);
    }
  },
};
