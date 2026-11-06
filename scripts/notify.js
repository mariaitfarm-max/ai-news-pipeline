// CLI: node scripts/notify.js "বার্তা"   (workflow-র failure ধাপ থেকে ব্যবহার হয়)
import { sendTelegram } from "./lib/notify.js";

const text = process.argv.slice(2).join(" ").trim() || "AI News: একটা workflow ফেল করেছে";
await sendTelegram(text);
