// config/sources.json-এর RSS/Atom ফিড টেনে একটা NewsAPI-সামঞ্জস্যপূর্ণ JSON বানায়
// (অ্যাপের Article মডেলের সাথে মেলে) এবং Cloudflare KV-তে "news" কী-তে লেখে।
// রাখা হয়: শিরোনাম, লিংক, ছোট স্নিপেট, ছবির লিংক, AI সামারি + মূল পয়েন্ট। পুরো লেখা কপি/সেভ হয় না।

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFeed, normalizeUrl, titleKey } from "./lib/rss.js";
import { truncate } from "./lib/text.js";
import { publish, readKey } from "./lib/publish.js";
import { summarize, isAuthError, DEFAULT_MODEL } from "./lib/ai.js";
import { fetchOgImage, pool } from "./lib/og.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = JSON.parse(fs.readFileSync(path.join(root, "config", "sources.json"), "utf8"));

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const PER_FEED = 15;
const TOTAL = 100;
const SNIPPET = 500;
const MIN_ARTICLES = Number(process.env.MIN_ARTICLES || 8);
const AI_ON = String(process.env.AI_SUMMARIES || "on").toLowerCase() !== "off";
const AI_MODEL = process.env.AI_MODEL || DEFAULT_MODEL;
const MAX_NEW_SUMMARIES = Number(process.env.MAX_NEW_SUMMARIES || 25);
const MAX_IMAGE_LOOKUPS = Number(process.env.MAX_IMAGE_LOOKUPS || 30);
const MIN_TEXT_FOR_AI = 80;
const UA = "AINewsBot/1.0 (+https://github.com/mariaitfarm-max/ai-news-pipeline)";

const AI_RE =
  /\b(AI|A\.I\.|LLMs?|AGI|artificial intelligence|machine learning|deep learning|neural|generative|chatbots?|openai|anthropic|chatgpt|gpt-?\d\w*|claude|gemini|deepmind|copilot|mistral|llama|nvidia|hugging ?face|grok|midjourney)\b/i;

async function fetchText(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(20000),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return text.length > 4_000_000 ? text.slice(0, 4_000_000) : text;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function loadSource(src) {
  const xml = await fetchText(src.url);
  const items = parseFeed(xml);
  if (items.length === 0) throw new Error("কোনো আইটেম পার্স হয়নি");
  return items.map((it) => ({ ...it, source: src.name, filter: !!src.filter }));
}

/** ক্যাশ-সহ AI সামারি + পয়েন্ট। ব্যর্থ হলে কিছু না বদলে চুপচাপ এগোয় */
async function addSummaries(articles, fullText) {
  if (!AI_ON) {
    console.log("AI সামারি বন্ধ (AI_SUMMARIES=off)");
    return;
  }
  const cache = (await readKey("summaries_v2")) || {};
  const fresh = {};
  let cached = 0;
  const todo = [];
  for (const a of articles) {
    const c = cache[a.url];
    if (c && typeof c.s === "string" && c.s) {
      a.aiSummary = c.s;
      a.aiPoints = Array.isArray(c.p) ? c.p : [];
      fresh[a.url] = c;
      cached++;
    } else if ((fullText.get(a) || "").length >= MIN_TEXT_FOR_AI) {
      todo.push(a);
    }
  }
  const batch = todo.slice(0, MAX_NEW_SUMMARIES); // নতুন→পুরনো ক্রমে
  let done = 0;
  let failed = 0;
  let stop = false;
  await pool(batch, 3, async (a) => {
    if (stop) return;
    try {
      const r = await summarize(AI_MODEL, a.title, fullText.get(a));
      if (r) {
        a.aiSummary = r.summary;
        a.aiPoints = r.points;
        fresh[a.url] = { s: r.summary, p: r.points };
        done++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      console.warn(`AI ব্যর্থ: ${String(e.message || e).slice(0, 200)}`);
      if (isAuthError(e)) {
        stop = true;
        console.warn("→ API Token-এ Account → Workers AI → Edit অনুমতি যোগ করুন (README দেখুন)। সামারি ছাড়াই চলছে।");
      }
    }
  });
  console.log(`AI সামারি: ক্যাশ ${cached}, নতুন ${done}, ব্যর্থ ${failed}, বাকি ${Math.max(0, todo.length - batch.length)}`);
  if (done > 0 || Object.keys(cache).length !== Object.keys(fresh).length) {
    await publish("summaries_v2", fresh);
  }
}

/** RSS-এ ছবি না থাকলে আর্টিকেল পেজের og:image লিংক (ক্যাশ-সহ) */
async function addImages(articles) {
  const cache = (await readKey("images_v1")) || {};
  const fresh = {};
  const todo = [];
  for (const a of articles) {
    if (a.urlToImage) continue;
    if (Object.prototype.hasOwnProperty.call(cache, a.url)) {
      a.urlToImage = cache[a.url] || null;
      fresh[a.url] = cache[a.url];
    } else {
      todo.push(a);
    }
  }
  const batch = todo.slice(0, MAX_IMAGE_LOOKUPS);
  let found = 0;
  let none = 0;
  let errors = 0;
  await pool(batch, 5, async (a) => {
    try {
      const img = await fetchOgImage(a.url);
      a.urlToImage = img;
      fresh[a.url] = img || "";
      if (img) found++;
      else none++;
    } catch {
      errors++; // ক্যাশ হয় না — পরের রানে আবার চেষ্টা
    }
  });
  const withImg = articles.filter((a) => a.urlToImage).length;
  console.log(`ছবি: ${withImg}/${articles.length} আর্টিকেলে (নতুন খোঁজা ${batch.length}: পেয়েছি ${found}, নেই ${none}, ত্রুটি ${errors})`);
  if (batch.length > 0 || Object.keys(cache).length !== Object.keys(fresh).length) {
    await publish("images_v1", fresh);
  }
}

async function main() {
  const now = Date.now();
  const results = await Promise.allSettled(SOURCES.map(loadSource));

  let okFeeds = 0;
  const all = [];
  results.forEach((r, i) => {
    const name = SOURCES[i].name;
    if (r.status === "fulfilled") {
      okFeeds++;
      const recent = r.value
        .filter((it) => {
          const t = Date.parse(it.publishedAt);
          return t <= now + 86400000 && now - t <= MAX_AGE_MS;
        })
        .filter((it) => !it.filter || AI_RE.test(it.title + " " + it.description))
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, PER_FEED);
      console.log(`OK    ${name}: ${recent.length}টা`);
      all.push(...recent);
    } else {
      console.warn(`FAIL  ${name}: ${String(r.reason && r.reason.message ? r.reason.message : r.reason)}`);
    }
  });

  const seenUrl = new Set();
  const seenTitle = new Set();
  const articles = [];
  const fullText = new Map(); // article -> সবচেয়ে বড় টেক্সট (শুধু AI-র ইনপুট, সেভ হয় না)
  for (const it of all.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    const uk = normalizeUrl(it.url);
    const tk = titleKey(it.title);
    if (seenUrl.has(uk) || seenTitle.has(tk)) continue;
    seenUrl.add(uk);
    seenTitle.add(tk);
    const best = it.content && it.content.length > it.description.length ? it.content : it.description;
    const art = {
      source: { id: null, name: it.source },
      author: null,
      title: it.title,
      description: truncate(best, SNIPPET),
      url: uk,
      urlToImage: it.imageUrl,
      publishedAt: it.publishedAt,
      content: null,
      aiSummary: null,
      aiPoints: [],
    };
    articles.push(art);
    fullText.set(art, best);
    if (articles.length >= TOTAL) break;
  }

  console.log(`ফিড ঠিক: ${okFeeds}/${SOURCES.length}, মোট আর্টিকেল: ${articles.length}`);
  if (okFeeds === 0 || articles.length < MIN_ARTICLES) {
    throw new Error(
      `মাত্র ${articles.length}টা আর্টিকেল (কমপক্ষে ${MIN_ARTICLES} দরকার) — আগের ডেটা না বদলে থামছি। ` +
        "উপরের FAIL লাইনগুলো দেখে config/sources.json ঠিক করো।"
    );
  }

  // সামারি/ছবি ব্যর্থ হলেও খবরের ফিড প্রকাশ হবে
  try {
    await addImages(articles);
  } catch (e) {
    console.warn("ছবির ধাপ ব্যর্থ, বাদ দিয়ে এগোচ্ছি:", String((e && e.message) || e));
  }
  try {
    await addSummaries(articles, fullText);
  } catch (e) {
    console.warn("সামারি ধাপ ব্যর্থ, বাদ দিয়ে এগোচ্ছি:", String((e && e.message) || e));
  }

  await publish("news", {
    status: "ok",
    generatedAt: new Date().toISOString(),
    totalResults: articles.length,
    articles,
  });
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
