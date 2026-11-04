// ফলাফল কোথায় যাবে: OUTPUT_DIR সেট থাকলে লোকাল ফাইলে (টেস্টের জন্য), না হলে Cloudflare KV-তে

import fs from "fs";
import path from "path";
import { ensureNamespace, kvPut, kvGet } from "./cf.js";

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

/** আগের লেখা ডেটা পড়া (ক্যাশের জন্য); না থাকলে বা ভাঙা হলে null */
export async function readKey(key) {
  try {
    let text;
    if (process.env.OUTPUT_DIR) {
      const file = path.join(process.env.OUTPUT_DIR, `${key}.json`);
      if (!fs.existsSync(file)) return null;
      text = fs.readFileSync(file, "utf8");
    } else {
      const ns = await ensureNamespace();
      text = await kvGet(ns, key);
    }
    return text ? JSON.parse(text) : null;
  } catch (e) {
    console.warn(`readKey(${key}) ব্যর্থ: ${String(e.message || e)}`);
    return null;
  }
}
