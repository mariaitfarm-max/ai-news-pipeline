// নির্ভরতা-ছাড়া ছোট RSS 2.0 / Atom পার্সার (CDATA, এন্টিটি, মিডিয়া ইমেজ সহ)

import { decodeEntities, stripHtml, collapse } from "./text.js";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tagRaw(block, name) {
  const re = new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}

/** CDATA থাকলে ভেতরের অংশ; না থাকলে একবার এন্টিটি ডিকোড (escaped HTML-ও ধরার জন্য) */
function unwrap(raw) {
  if (raw.includes("<![CDATA[")) {
    return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c);
  }
  return decodeEntities(raw);
}

function toPlain(raw) {
  return collapse(decodeEntities(stripHtml(unwrap(raw))));
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${esc(name)}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

function firstTagAttr(block, tagName, attrName, filter) {
  const re = new RegExp(`<${esc(tagName)}\\b[^>]*>`, "gi");
  for (const m of block.matchAll(re)) {
    if (filter && !filter(m[0])) continue;
    const v = attr(m[0], attrName);
    if (v) return v;
  }
  return null;
}

function pickLink(block) {
  const plain = tagRaw(block, "link");
  if (plain) {
    const t = toPlain(plain);
    if (/^https?:\/\//i.test(t)) return t;
  }
  let fallback = null;
  for (const m of block.matchAll(/<link\b[^>]*>/gi)) {
    const href = attr(m[0], "href");
    if (!href) continue;
    const rel = (attr(m[0], "rel") || "alternate").toLowerCase();
    if (rel === "alternate") return href;
    if (!fallback && rel !== "self" && rel !== "replies") fallback = href;
  }
  return fallback;
}

function pickImage(block, htmlSource) {
  const isImg = (tag) => {
    const type = (attr(tag, "type") || "").toLowerCase();
    const medium = (attr(tag, "medium") || "").toLowerCase();
    return (!type && !medium) || type.startsWith("image") || medium === "image";
  };
  const cand =
    firstTagAttr(block, "media:content", "url", isImg) ||
    firstTagAttr(block, "media:thumbnail", "url") ||
    firstTagAttr(block, "enclosure", "url", (t) => (attr(t, "type") || "").toLowerCase().startsWith("image")) ||
    (htmlSource ? (htmlSource.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] : null);
  if (!cand) return null;
  const url = decodeEntities(cand);
  return /^https:\/\//i.test(url) ? url : null;
}

/** @returns {{title:string,url:string,description:string,publishedAt:string,imageUrl:string|null}[]} */
export function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const block = m[2];

    const titleRaw = tagRaw(block, "title");
    const title = titleRaw ? toPlain(titleRaw) : "";
    const url = pickLink(block);
    if (!title || !url) continue;

    const dateRaw =
      tagRaw(block, "pubDate") || tagRaw(block, "published") || tagRaw(block, "updated") || tagRaw(block, "dc:date");
    const d = dateRaw ? new Date(toPlain(dateRaw)) : null;
    if (!d || Number.isNaN(d.getTime())) continue;

    const descRaw =
      tagRaw(block, "description") || tagRaw(block, "summary") || tagRaw(block, "content:encoded") || tagRaw(block, "content");
    const htmlSource = descRaw ? unwrap(descRaw) : "";
    const imgHtml = htmlSource.includes("<") ? htmlSource : decodeEntities(htmlSource);

    items.push({
      title,
      url,
      description: descRaw ? toPlain(descRaw) : "",
      publishedAt: d.toISOString(),
      imageUrl: pickImage(block, imgHtml),
    });
  }
  return items;
}

const TRACKING = /^(utm_|fbclid$|gclid$|ref$|ref_src$|mc_cid$|mc_eid$)/i;

export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) {
      if (TRACKING.test(k)) x.searchParams.delete(k);
    }
    if (x.pathname.length > 1 && x.pathname.endsWith("/")) x.pathname = x.pathname.slice(0, -1);
    return x.toString();
  } catch {
    return u;
  }
}

export function titleKey(t) {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
