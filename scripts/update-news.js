// config/sources.json-এর RSS/Atom ফিড টেনে একটা NewsAPI-সামঞ্জস্যপূর্ণ JSON বানায়
// (অ্যাপের আগের Article মডেলের সাথে মেলে) এবং Cloudflare KV-তে "news" কী-তে লেখে।
// শুধু শিরোনাম, লিংক ও ছোট স্নিপেট রাখা হয় — পুরো লেখা কপি করা হয় না।

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFeed, normalizeUrl, titleKey } from "./lib/rss.js";
import { truncate } from "./lib/text.js";
import { publish } from "./lib/publish.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = JSON.parse(fs.readFileSync(path.join(root, "config", "sources.json"), "utf8"));

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const PER_FEED = 15;
const TOTAL = 100;
const SNIPPET = 400;
const MIN_ARTICLES = Number(process.env.MIN_ARTICLES || 8);
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
  for (const it of all.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    const uk = normalizeUrl(it.url);
    const tk = titleKey(it.title);
    if (seenUrl.has(uk) || seenTitle.has(tk)) continue;
    seenUrl.add(uk);
    seenTitle.add(tk);
    articles.push({
      source: { id: null, name: it.source },
      author: null,
      title: it.title,
      description: truncate(it.description, SNIPPET),
      url: uk,
      urlToImage: it.imageUrl,
      publishedAt: it.publishedAt,
      content: null,
    });
    if (articles.length >= TOTAL) break;
  }

  console.log(`ফিড ঠিক: ${okFeeds}/${SOURCES.length}, মোট আর্টিকেল: ${articles.length}`);
  if (okFeeds === 0 || articles.length < MIN_ARTICLES) {
    throw new Error(
      `মাত্র ${articles.length}টা আর্টিকেল (কমপক্ষে ${MIN_ARTICLES} দরকার) — আগের ডেটা না বদলে থামছি। ` +
        "উপরের FAIL লাইনগুলো দেখে config/sources.json ঠিক করো।"
    );
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
