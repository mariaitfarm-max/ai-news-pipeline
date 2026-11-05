// আর্টিকেল পেজের <head> থেকে og:image / twitter:image বের করা (RSS-এ ছবি না থাকলে ফলব্যাক)।
// শুধু ছবির লিংক রাখা হয় — ছবি ডাউনলোড বা কপি করা হয় না; অ্যাপ সরাসরি সোর্সের সার্ভার থেকে দেখায়।

import { decodeEntities } from "./text.js";

const UA = "AINewsBot/1.0 (+https://github.com/mariaitfarm-max/ai-news-pipeline)";

export function parseOgImage(html, baseUrl) {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  const find = (key) => {
    for (const m of metas) {
      const prop = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(m);
      if (!prop || prop[1].toLowerCase() !== key) continue;
      const c = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(m);
      if (c && c[1]) return decodeEntities(c[1]).trim();
    }
    return null;
  };
  const raw = find("og:image:secure_url") || find("og:image") || find("twitter:image") || find("twitter:image:src");
  if (!raw) return null;
  try {
    const u = new URL(raw, baseUrl);
    if (u.protocol !== "https:") return null;
    if (/(pixel|1x1|spacer|beacon|tracker)/i.test(u.toString())) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** ছবির লিংক বা null (ছবি নেই / ৪xx); নেটওয়ার্ক-ত্রুটি/টাইমআউটে throw — যাতে পরের রানে আবার চেষ্টা হয় */
export async function fetchOgImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });
  if (res.status >= 400 && res.status < 500) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let html = await res.text();
  const end = html.search(/<\/head>/i);
  html = end > 0 ? html.slice(0, end) : html.slice(0, 300_000);
  return parseOgImage(html, res.url || url);
}

/** সহজ সমান্তরাল পুল */
export async function pool(items, size, fn) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}
