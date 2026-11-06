// দৈনিক পরিষ্কার:
//  ১) RETENTION_DAYS-এর (ডিফল্ট ৭) চেয়ে পুরনো সম্পন্ন Actions রান মোছা (GITHUB_TOKEN লাগে)
//  ২) KV-র অচেনা কী মোছা + summaries_v2 / images_v1 থেকে বর্তমান ফিডে নেই এমন এন্ট্রি ছাঁটা

import { ensureNamespace, kvList, kvDelete } from "./lib/cf.js";
import { publish, readKey } from "./lib/publish.js";

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 7);
const MAX_DELETES = Number(process.env.MAX_RUN_DELETES || 400);
const KNOWN_KEYS = new Set(["news", "news_meta", "pricing", "summaries_v2", "images_v1", "alert_state"]);

/** শুধু সম্পন্ন (completed) ও cutoff-এর আগের রান বাছে */
export function selectRunsToDelete(runs, cutoffMs) {
  return runs.filter((r) => r.status === "completed" && Date.parse(r.created_at) < cutoffMs).map((r) => r.id);
}

async function gh(path, method = "GET") {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ainews-cleanup",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (method === "GET") {
    if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status}`);
    return res.json();
  }
  return res.status;
}

async function cleanRuns() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.env.GITHUB_TOKEN) {
    console.log("GITHUB_REPOSITORY/GITHUB_TOKEN নেই — রান মোছা বাদ");
    return;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const day = new Date(cutoff).toISOString().slice(0, 10);
  let deleted = 0;
  let failed = 0;
  for (let page = 0; page < 10 && deleted < MAX_DELETES; page++) {
    // সবসময় প্রথম পাতা: মোছার পর বাকিগুলো ওপরে উঠে আসে
    const data = await gh(`/repos/${repo}/actions/runs?status=completed&per_page=100&created=%3C${day}`);
    const ids = selectRunsToDelete(data.workflow_runs || [], cutoff);
    if (ids.length === 0) break;
    for (const id of ids) {
      if (deleted >= MAX_DELETES) break;
      const code = await gh(`/repos/${repo}/actions/runs/${id}`, "DELETE");
      if (code === 204) deleted++;
      else failed++;
    }
    if (failed > 20) break;
  }
  console.log(`Actions রান মোছা: ${deleted}টা (ব্যর্থ ${failed}), ${RETENTION_DAYS} দিনের পুরনো`);
}

async function cleanKv() {
  const ns = await ensureNamespace();
  const keys = await kvList(ns);
  const stray = keys.filter((k) => !KNOWN_KEYS.has(k));
  for (const k of stray) {
    await kvDelete(ns, k);
    console.log(`KV অচেনা কী মুছলাম: ${k}`);
  }

  const news = await readKey("news");
  const urls = new Set(((news && news.articles) || []).map((a) => a.url));
  if (urls.size < 8) {
    console.log("বর্তমান ফিড ছোট/নেই — ক্যাশ ছাঁটা বাদ (নিরাপত্তার জন্য)");
    return;
  }
  for (const key of ["summaries_v2", "images_v1"]) {
    const cache = await readKey(key);
    if (!cache) continue;
    const kept = Object.fromEntries(Object.entries(cache).filter(([u]) => urls.has(u)));
    const before = Object.keys(cache).length;
    const after = Object.keys(kept).length;
    if (after < before) {
      await publish(key, kept);
      console.log(`${key}: ${before} → ${after}`);
    } else {
      console.log(`${key}: ${before}টা, ছাঁটার কিছু নেই`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("cleanup.js")) {
  try {
    await cleanRuns();
  } catch (e) {
    console.warn("রান মোছা ব্যর্থ:", String((e && e.message) || e));
  }
  try {
    await cleanKv();
  } catch (e) {
    console.error("KV পরিষ্কার ব্যর্থ:", String((e && e.message) || e));
    process.exit(1);
  }
}
