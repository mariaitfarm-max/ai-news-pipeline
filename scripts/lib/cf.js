// Cloudflare REST API-র ছোট হেল্পার (KV namespace, workers.dev subdomain, KV লেখা)
// দরকারি env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

const API = "https://api.cloudflare.com/client/v4";
export const KV_TITLE = "ainews-data";

export function creds() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID সেট করা নেই। " +
        "GitHub রিপো → Settings → Secrets and variables → Actions → New repository secret"
    );
  }
  return { token, account };
}

async function call(path, { method = "GET", json, text } = {}) {
  const { token } = creds();
  const headers = { Authorization: `Bearer ${token}` };
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (text !== undefined) {
    headers["Content-Type"] = "text/plain";
    body = text;
  }
  const res = await fetch(API + path, { method, headers, body, signal: AbortSignal.timeout(30000) });
  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* JSON না হলে raw থাকবে */
  }
  if (!res.ok || (data && data.success === false)) {
    const msg = data && data.errors ? data.errors.map((e) => `${e.code}: ${e.message}`).join("; ") : raw.slice(0, 200);
    throw new Error(`Cloudflare API ${method} ${path.split("?")[0]} -> ${res.status} ${msg}`);
  }
  return data ? data.result : raw;
}

export async function ensureNamespace(title = KV_TITLE) {
  const { account } = creds();
  for (let page = 1; page <= 10; page++) {
    const list = await call(`/accounts/${account}/storage/kv/namespaces?per_page=100&page=${page}`);
    const hit = list.find((n) => n.title === title);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  const created = await call(`/accounts/${account}/storage/kv/namespaces`, { method: "POST", json: { title } });
  return created.id;
}

export async function getSubdomain() {
  const { account } = creds();
  try {
    const r = await call(`/accounts/${account}/workers/subdomain`);
    return r && r.subdomain ? r.subdomain : null;
  } catch {
    return null;
  }
}

export async function createSubdomain(name) {
  const { account } = creds();
  const r = await call(`/accounts/${account}/workers/subdomain`, { method: "PUT", json: { subdomain: name } });
  return r && r.subdomain ? r.subdomain : name;
}

export async function kvPut(nsId, key, value) {
  const { account } = creds();
  await call(`/accounts/${account}/storage/kv/namespaces/${nsId}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    text: value,
  });
}

/** KV-র সব কী-এর নাম */
export async function kvList(nsId) {
  const { account } = creds();
  const keys = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const q = `?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const { token } = creds();
    const res = await fetch(`${API}/accounts/${account}/storage/kv/namespaces/${nsId}/keys${q}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Cloudflare KV list -> ${res.status}`);
    const data = await res.json();
    for (const k of data.result || []) keys.push(k.name);
    cursor = data.result_info && data.result_info.cursor;
    if (!cursor) break;
  }
  return keys;
}

export async function kvDelete(nsId, key) {
  const { account } = creds();
  await call(`/accounts/${account}/storage/kv/namespaces/${nsId}/values/${encodeURIComponent(key)}`, { method: "DELETE" });
}

/** KV থেকে মান পড়া; কী না থাকলে null */
export async function kvGet(nsId, key) {
  const { token, account } = creds();
  const res = await fetch(
    `${API}/accounts/${account}/storage/kv/namespaces/${nsId}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cloudflare KV GET ${key} -> ${res.status}`);
  return await res.text();
}

/** Workers AI চালানো (REST)। মডেল-পাথে "/" থাকে (@cf/meta/...), তাই encode করা হয় না */
export async function aiRun(model, input) {
  const { account } = creds();
  const r = await call(`/accounts/${account}/ai/run/${model}`, { method: "POST", json: input });
  if (r && typeof r === "object") {
    if (typeof r.response === "string") return r.response;
    const c = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
    if (typeof c === "string") return c;
  }
  throw new Error("Workers AI: অপ্রত্যাশিত রেসপন্স ফরম্যাট");
}
