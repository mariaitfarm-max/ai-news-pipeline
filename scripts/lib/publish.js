// ফলাফল কোথায় যাবে: OUTPUT_DIR সেট থাকলে লোকাল ফাইলে (টেস্টের জন্য), না হলে Cloudflare KV-তে

import fs from "fs";
import path from "path";
import { ensureNamespace, kvPut } from "./cf.js";

export async function publish(key, data) {
  const body = JSON.stringify(data);
  if (process.env.OUTPUT_DIR) {
    fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });
    const file = path.join(process.env.OUTPUT_DIR, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`ফাইলে লেখা হয়েছে: ${file}`);
    return;
  }
  const ns = await ensureNamespace();
  await kvPut(ns, key, body);
  console.log(`KV-তে লেখা হয়েছে: ${key} (${body.length} bytes)`);
}
