// OpenRouter-এর পাবলিক /models API থেকে (কোনো API key ছাড়া) কিউরেটেড মডেলের
// দাম ও বেঞ্চমার্ক টেনে Cloudflare KV-তে "pricing" কী-তে লেখে।
// আউটপুট ফরম্যাট আগের model-pricing.json-এর হুবহু একই — অ্যাপে কোনো বদল লাগে না।

import { publish } from "./lib/publish.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const MIN_MODELS = 3; // এর কম এলে কিছু একটা ভুল — আগের ডেটা অক্ষত থাকবে

// তুলনায় যে মডেলগুলো দেখাতে চাও তাদের id-এর শুরুটা। নতুন মডেল এলে এই লিস্ট এডিট করো।
const INCLUDE_PREFIXES = [
  "openai/gpt-6-astra",
  "openai/gpt-6-sol",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-fable-5.1",
  "google/gemini-3.8-flash",
  "google/gemini-3.7-flash",
  "meta/muse-spark-1.3",
  "x-ai/grok-4.7",
  "deepseek/deepseek-v4.1-flash",
  "z-ai/glm-5.3",
  "qwen/qwen3.8-max",
];

function perMillion(pricePerToken) {
  const n = Number(pricePerToken);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1_000_000 * 100) / 100;
}

async function main() {
  const res = await fetch(OPENROUTER_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`OpenRouter API এরর: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const all = Array.isArray(json.data) ? json.data : [];

  const rows = all
    .filter((m) => typeof m.id === "string" && INCLUDE_PREFIXES.some((p) => m.id.startsWith(p)))
    .map((m) => {
      const ai = m.benchmarks && m.benchmarks.artificial_analysis;
      const pricing = m.pricing || {};
      return {
        id: m.id,
        name: m.name,
        provider: m.id.split("/")[0],
        input_price_per_million_usd: perMillion(pricing.prompt),
        output_price_per_million_usd: perMillion(pricing.completion),
        is_free: pricing.prompt === "0" && pricing.completion === "0",
        context_length: m.context_length || null,
        intelligence_index: ai ? ai.intelligence_index : null,
        coding_index: ai ? ai.coding_index : null,
        input_modalities: (m.architecture && m.architecture.input_modalities) || [],
      };
    });

  if (rows.length < MIN_MODELS) {
    throw new Error(
      `মাত্র ${rows.length}টা মডেল মিলেছে (কমপক্ষে ${MIN_MODELS} দরকার) — আগের ডেটা না বদলে থামছি। ` +
        "INCLUDE_PREFIXES লিস্ট বা OpenRouter-এর ফরম্যাট দেখো।"
    );
  }

  rows.sort((a, b) => {
    if (a.input_price_per_million_usd == null) return 1;
    if (b.input_price_per_million_usd == null) return -1;
    return a.input_price_per_million_usd - b.input_price_per_million_usd;
  });

  await publish("pricing", {
    last_updated: new Date().toISOString(),
    source: OPENROUTER_URL,
    model_count: rows.length,
    models: rows,
  });
  console.log(`${rows.length}টা মডেল`);
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
