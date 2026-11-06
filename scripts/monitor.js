// /health দেখে সমস্যা হলে Telegram-এ জানায় (একই সমস্যা বারবার নয় — অবস্থা KV "alert_state"-এ থাকে)।
// URL: env WORKER_URL, না থাকলে status/backend-url.txt

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ensureNamespace, kvGet, kvPut } from "./lib/cf.js";
import { evaluateHealth, decideAlert } from "./lib/health.js";
import { sendTelegram } from "./lib/notify.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function workerUrl() {
  const env = (process.env.WORKER_URL || "").trim();
  if (env) return env.replace(/\/+$/, "");
  const f = path.join(root, "status", "backend-url.txt");
  if (!fs.existsSync(f)) throw new Error("WORKER_URL নেই এবং status/backend-url.txt-ও নেই — আগে Deploy workflow চালাও");
  return fs.readFileSync(f, "utf8").trim().replace(/\/+$/, "");
}

async function fetchHealth(base) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.json();
    } catch {
      /* আবার চেষ্টা */
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
}

async function main() {
  const base = workerUrl();
  const health = await fetchHealth(base);
  const problems = evaluateHealth(health);

  let ns = null;
  let state = null;
  try {
    ns = await ensureNamespace();
    const raw = await kvGet(ns, "alert_state");
    state = raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("alert_state পড়া গেল না, নতুন ধরে এগোচ্ছি:", String((e && e.message) || e));
  }

  const { send, next } = decideAlert(problems, state);
  console.log(problems.length ? "সমস্যা:\n- " + problems.map((p) => p.text).join("\n- ") : "সব ঠিক আছে");

  if (send) {
    const list = problems.map((p) => "• " + p.text).join("\n");
    const msg =
      send === "recovered"
        ? `✅ AI News ব্যাকএন্ড আবার ঠিক হয়েছে\n${base}`
        : `${send === "remind" ? "⏰ (রিমাইন্ডার) " : "🚨 "}AI News ব্যাকএন্ডে সমস্যা:\n${list}\n\n${base}/health`;
    await sendTelegram(msg);
  }
  if (ns) {
    try {
      await kvPut(ns, "alert_state", JSON.stringify(next));
    } catch (e) {
      console.warn("alert_state লেখা গেল না:", String((e && e.message) || e));
    }
  }
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
