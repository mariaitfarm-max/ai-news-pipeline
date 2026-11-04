import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, normalizeUrl, titleKey } from "../scripts/lib/rss.js";
import { truncate } from "../scripts/lib/text.js";

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

import { cleanSummary, isAuthError } from "../scripts/lib/ai.js";

test("cleanSummary: strips preface/quotes/markdown, rejects junk, caps length", () => {
  assert.equal(
    cleanSummary('Here is a summary: "OpenAI released a new model. It is faster and cheaper than before."'),
    "OpenAI released a new model. It is faster and cheaper than before."
  );
  assert.equal(cleanSummary("**Summary:** Nvidia announced new chips for data centers today."), "Nvidia announced new chips for data centers today.");
  assert.equal(cleanSummary("ok"), null);
  assert.equal(cleanSummary(undefined), null);
  const long = cleanSummary("A sentence here. ".repeat(60));
  assert.ok(long.length <= 361);
});

test("isAuthError", () => {
  assert.ok(isAuthError(new Error("Cloudflare API POST /x -> 403 10000: Authentication error")));
  assert.ok(!isAuthError(new Error("-> 500 internal")));
});
