// scripts/fetch-pricing.js
//
// OpenRouter-এর পাবলিক /models API থেকে ডেটা টেনে (কোনো API key লাগে না),
// একটা কিউরেটেড লিস্টের মডেলগুলো বেছে নিয়ে, তুলনার জন্য দরকারি ফিল্ডগুলো
// বের করে OUTPUT_PATH-এ একটা JSON ফাইল হিসেবে সেভ করে।

const fs = require("fs");
const path = require("path");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(__dirname, "..", "model-pricing.json");

// এখানে যে মডেলগুলো তুলনায় দেখাতে চাও, তাদের id-এর শুরুটা (prefix) লিখে
// রাখো। OpenRouter-এর id ফরম্যাট: "provider/model-slug"। নতুন মডেল বাজারে
// এলে বা কোনো মডেল বাদ দিতে চাইলে এই লিস্টটা এডিট করলেই হবে।
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
  if (!isFinite(n)) return null;
  return Math.round(n * 1_000_000 * 100) / 100; // ২ দশমিক ঘর পর্যন্ত
}

async function main() {
  const res = await fetch(OPENROUTER_URL);
  if (!res.ok) {
    throw new Error(`OpenRouter API এরর: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const allModels = json.data || [];

  const curated = allModels.filter((m) =>
    INCLUDE_PREFIXES.some((prefix) => m.id.startsWith(prefix))
  );

  const rows = curated.map((m) => {
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

  // দাম কম থেকে বেশি সাজানো (input price অনুযায়ী), যেগুলোর দাম-তথ্য নেই সেগুলো শেষে
  rows.sort((a, b) => {
    if (a.input_price_per_million_usd == null) return 1;
    if (b.input_price_per_million_usd == null) return -1;
    return a.input_price_per_million_usd - b.input_price_per_million_usd;
  });

  const output = {
    last_updated: new Date().toISOString(),
    source: "https://openrouter.ai/api/v1/models",
    model_count: rows.length,
    models: rows,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`লেখা হয়েছে ${rows.length}টা মডেল -> ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
