import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, normalizeUrl, titleKey } from "../scripts/lib/rss.js";
import { truncate, cleanBoilerplate } from "../scripts/lib/text.js";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Feed</title><link>https://example.com</link>
<item>
  <title><![CDATA[OpenAI &amp; friends launch “GPT-6”]]></title>
  <link>https://example.com/a?utm_source=x&amp;id=5</link>
  <pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
  <description><![CDATA[<p>Big <b>news</b> today.&nbsp;Read more&hellip;</p><img src="https://img.example.com/a.jpg">]]></description>
  <media:content url="https://img.example.com/m.jpg" medium="image"/>
</item>
<item>
  <title>Escaped &lt;i&gt;HTML&lt;/i&gt; title &amp;amp; more</title>
  <link>https://example.com/b</link>
  <pubDate>2026-11-03T08:00:00Z</pubDate>
  <description>&lt;p&gt;Escaped &lt;a href="x"&gt;desc&lt;/a&gt;&lt;/p&gt;</description>
</item>
<item><title>No date</title><link>https://example.com/c</link></item>
<item><title></title><link>https://example.com/d</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom</title><link rel="self" href="https://example.org/feed"/>
<entry>
  <title type="html">Atom &amp; entry</title>
  <link rel="alternate" href="https://example.org/post/1"/>
  <link rel="enclosure" href="https://example.org/x.mp3"/>
  <published>2026-11-01T12:30:00+00:00</published>
  <summary>Short summary</summary>
</entry>
</feed>`;

test("RSS: CDATA, entities, tags, image, skipping bad items", () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "OpenAI & friends launch “GPT-6”");
  assert.equal(items[0].url, "https://example.com/a?utm_source=x&id=5");
  assert.equal(items[0].description, "Big news today. Read more…");
  assert.equal(items[0].imageUrl, "https://img.example.com/m.jpg");
  assert.equal(items[0].publishedAt, "2026-11-02T10:00:00.000Z");
  assert.equal(items[1].title, "Escaped HTML title & more");
  assert.equal(items[1].description, "Escaped desc");
});

test("Atom: alternate link, summary, date", () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.org/post/1");
  assert.equal(items[0].title, "Atom & entry");
  assert.equal(items[0].description, "Short summary");
});

test("normalizeUrl strips tracking params, keeps real ones", () => {
  assert.equal(normalizeUrl("https://Example.com/a/?utm_source=x&id=5#top"), "https://example.com/a?id=5");
  assert.equal(normalizeUrl("https://example.com/"), "https://example.com/");
});

test("titleKey and truncate", () => {
  assert.equal(titleKey("Hello, World!!"), "hello world");
  assert.ok(truncate("word ".repeat(200), 100).length <= 101);
  assert.equal(truncate("short", 100), "short");
});

import { cleanSummary, parseAi, isAuthError } from "../scripts/lib/ai.js";
import { parseOgImage } from "../scripts/lib/og.js";

test("cleanSummary: strips preface/quotes/markdown, rejects junk, caps length", () => {
  assert.equal(
    cleanSummary('Here is a summary: "OpenAI released a new model. It is faster and cheaper than before."'),
    "OpenAI released a new model. It is faster and cheaper than before."
  );
  assert.equal(cleanSummary("**Summary:** Nvidia announced new chips for data centers today."), "Nvidia announced new chips for data centers today.");
  assert.equal(cleanSummary("ok"), null);
  assert.equal(cleanSummary(undefined), null);
  const long = cleanSummary("A sentence here. ".repeat(60), 360);
  assert.ok(long.length <= 361);
});

test("isAuthError", () => {
  assert.ok(isAuthError(new Error("Cloudflare API POST /x -> 403 10000: Authentication error")));
  assert.ok(!isAuthError(new Error("-> 500 internal")));
});

test("parseAi: summary + points, with and without labels", () => {
  const r = parseAi("SUMMARY: OpenAI shipped a faster model on Tuesday. Developers get lower prices.\nPOINTS:\n- Faster and cheaper model\n- Aimed at developers\n1. Available in the API today");
  assert.equal(r.summary, "OpenAI shipped a faster model on Tuesday. Developers get lower prices.");
  assert.deepEqual(r.points, ["Faster and cheaper model", "Aimed at developers", "Available in the API today"]);
  const plain = parseAi("A plain paragraph summary that has no labels but is long enough to keep.");
  assert.equal(plain.points.length, 0);
  assert.equal(parseAi("hi"), null);
});

test("parseOgImage: attribute order, relative URL, http rejected, twitter fallback", () => {
  assert.equal(
    parseOgImage('<meta content="/img/a.jpg" property="og:image"><title>x</title>', "https://news.example.com/post/1"),
    "https://news.example.com/img/a.jpg"
  );
  assert.equal(parseOgImage('<meta property="og:image" content="http://a.com/x.jpg">', "https://a.com"), null);
  assert.equal(parseOgImage('<meta name="twitter:image" content="https://a.com/t.png?x=1&amp;y=2">', "https://a.com"), "https://a.com/t.png?x=1&y=2");
  assert.equal(parseOgImage("<html></html>", "https://a.com"), null);
});

test("cleanBoilerplate strips trailing feed junk only", () => {
  assert.equal(cleanBoilerplate("Big news today about AI. Continue reading..."), "Big news today about AI.");
  assert.equal(cleanBoilerplate("Big news. Read more…"), "Big news.");
  assert.equal(cleanBoilerplate("Story text here. The post Big news appeared first on TechCrunch."), "Story text here.");
  assert.equal(cleanBoilerplate("Plain text with nothing to strip."), "Plain text with nothing to strip.");
});
