// /health-এর জবাব দেখে সমস্যার তালিকা বানায় (মনিটর ও টেস্ট দুটোই ব্যবহার করে)

const H = 3600 * 1000;

/** @returns {{key:string,text:string}[]} খালি = সব ঠিক */
export function evaluateHealth(health, now = Date.now(), opts = {}) {
  const newsMaxH = opts.newsMaxH ?? 2;
  const pricingMaxH = opts.pricingMaxH ?? 30;
  const minFeedRatio = opts.minFeedRatio ?? 0.5;
  const problems = [];

  if (!health || health.ok !== true) {
    return [{ key: "api_down", text: "API সাড়া দিচ্ছে না বা /health ভুল জবাব দিচ্ছে" }];
  }

  const age = (iso) => {
    const t = Date.parse(iso || "");
    return Number.isFinite(t) ? (now - t) / H : null;
  };

  const n = health.news;
  if (!n || !n.updated_at) {
    problems.push({ key: "news_missing", text: "নিউজ ডেটা নেই (update-news কখনো সফল হয়নি?)" });
  } else {
    const a = age(n.updated_at);
    if (a === null || a > newsMaxH) {
      problems.push({ key: "news_stale", text: `নিউজ ডেটা পুরনো: ${a === null ? "তারিখ অজানা" : a.toFixed(1) + " ঘণ্টা আগের"} (সীমা ${newsMaxH} ঘণ্টা)` });
    }
    if (typeof n.count === "number" && n.count < 8) {
      problems.push({ key: "news_few", text: `নিউজ খুব কম: মাত্র ${n.count}টা` });
    }
    const f = n.feeds;
    if (f && f.total > 0 && f.ok / f.total < minFeedRatio) {
      const names = Array.isArray(f.failed) ? f.failed.join(", ") : "";
      problems.push({ key: "feeds_failing", text: `ফিডের ${f.total - f.ok}/${f.total}টা ফেল করছে: ${names}` });
    }
    const ai = n.ai;
    if (ai && ai.enabled && ai.attempted >= 5 && ai.done === 0 && ai.stopped !== "quota") {
      problems.push({ key: "ai_failing", text: `AI সামারি ফেল করছে (${ai.attempted}টা চেষ্টায় ০টা সফল; মডেল: ${ai.model || "?"}) — মডেল বন্ধ হয়ে থাকতে পারে` });
    }
  }

  const p = health.pricing;
  if (!p || !p.updated_at) {
    problems.push({ key: "pricing_missing", text: "মডেল-দামের ডেটা নেই" });
  } else {
    const a = age(p.updated_at);
    if (a === null || a > pricingMaxH) {
      problems.push({ key: "pricing_stale", text: `মডেল-দামের ডেটা পুরনো: ${a === null ? "তারিখ অজানা" : a.toFixed(0) + " ঘণ্টা আগের"}` });
    }
  }
  return problems;
}

/**
 * আগের অবস্থার সাথে তুলনা করে কী পাঠাতে হবে ঠিক করে (বারবার একই সতর্কতা নয়)।
 * state = {sig, notifiedAt} | null
 * @returns {{send:string|null, next:{sig:string,notifiedAt:number}}}
 */
export function decideAlert(problems, state, now = Date.now(), remindEveryH = 12) {
  const sig = problems.map((p) => p.key).sort().join(",");
  const prevSig = (state && state.sig) || "";
  const lastAt = (state && state.notifiedAt) || 0;
  if (sig && sig !== prevSig) {
    return { send: "bad", next: { sig, notifiedAt: now } };
  }
  if (!sig && prevSig) {
    return { send: "recovered", next: { sig: "", notifiedAt: now } };
  }
  if (sig && now - lastAt > remindEveryH * H) {
    return { send: "remind", next: { sig, notifiedAt: now } };
  }
  return { send: null, next: { sig, notifiedAt: lastAt } };
}
