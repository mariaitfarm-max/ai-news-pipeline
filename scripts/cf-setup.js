// Cloudflare-এ একবারের সেটআপ (বারবার চালালেও নিরাপদ):
//  1) KV namespace "ainews-data" না থাকলে বানায়
//  2) workers.dev subdomain না থাকলে বানায়
//  3) worker/wrangler.toml লেখে
//  4) Worker URL আউটপুট দেয়

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { ensureNamespace, getSubdomain, createSubdomain } from "./lib/cf.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_NAME = "ainews-api";

async function main() {
  const kvId = await ensureNamespace();
  console.log("KV namespace ok");

  let sub = await getSubdomain();
  if (!sub) {
    const wanted = "ainews-" + crypto.randomBytes(3).toString("hex");
    try {
      sub = await createSubdomain(wanted);
      console.log("workers.dev subdomain তৈরি হলো:", sub);
    } catch (e) {
      console.error(String(e.message || e));
      console.error(
        "\nsubdomain অটো-তৈরি হয়নি। dash.cloudflare.com → Workers & Pages একবার খুলুন " +
          "(সেখানে subdomain বানাতে বলবে), তারপর এই workflow আবার Run করুন."
      );
      process.exit(1);
    }
  }

  // GitHub Actions-এ GITHUB_REPOSITORY / GITHUB_REF_NAME নিজে থেকে থাকে
  const repo = process.env.GITHUB_REPOSITORY || "";
  const ref = process.env.GITHUB_REF_NAME || "main";

  const toml = [
    `name = "${WORKER_NAME}"`,
    `main = "src/index.js"`,
    `compatibility_date = "2025-06-01"`,
    `workers_dev = true`,
    `keep_vars = true`,
    ``,
    `# Cron: খবর প্রতি ৩০ মিনিটে, দাম দিনে ২ বার — GitHub-এর শিডিউল ভরসা না করে Cloudflare নিজে workflow চালু করে`,
    `# (worker/src/index.js-এর PRICING_CRON-এর সাথে মিল থাকতে হবে)`,
    `[triggers]`,
    `crons = ["2,32 * * * *", "23 3,15 * * *"]`,
    ``,
    `[vars]`,
    `GH_REPO = "${repo}"`,
    `GH_REF = "${ref}"`,
    ``,
    `[[kv_namespaces]]`,
    `binding = "AINEWS"`,
    `id = "${kvId}"`,
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(root, "worker", "wrangler.toml"), toml);

  const url = `https://${WORKER_NAME}.${sub}.workers.dev`;
  console.log("Worker URL:", url);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `worker_url=${url}\n`);
  }
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
