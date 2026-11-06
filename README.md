# AI News — Backend (GitHub Actions + Cloudflare Workers)

```
GitHub Actions (cron) ──► Cloudflare KV ──► Cloudflare Worker ──► Android অ্যাপ
 • প্রতি ৩০ মিনিট: RSS (১৮টা সোর্স) → ছবি + AI সামারি → /api/news
 • দিনে ২ বার: OpenRouter → /api/model-pricing
 • প্রতি ৩০ মিনিট: monitor → সমস্যা হলে Telegram
 • প্রতিদিন: cleanup (পুরনো রান + KV ময়লা)
```

## Workflow-গুলো

| Workflow | কখন | কাজ |
|---|---|---|
| Update AI News | প্রতি ৩০ মিনিট | RSS টানা, ছবি, AI সামারি, KV-তে লেখা |
| Update AI Model Pricing | দিনে ২ বার | মডেলের দাম/বেঞ্চমার্ক; ব্যর্থ হলে Telegram |
| Monitor | প্রতি ৩০ মিনিট | `/health` দেখে সমস্যা হলে Telegram (একবারই জানায়, ঠিক হলে জানায়) |
| Daily Cleanup | প্রতিদিন | ৭ দিনের পুরনো রান মোছা, KV-র অচেনা কী/বাতিল ক্যাশ ছাঁটা, সোমবারে keepalive কমিট |
| Deploy API | `worker/**` বদলালে / হাতে | Worker ডিপ্লয় + health check |
| CI | কোড বদলালে | `npm test` |
| Auto Unzip | রুটে `.zip` পুশ করলে | zip খুলে দেয় |

## Secrets (রিপো → Settings → Secrets and variables → Actions)

| নাম | কী |
|---|---|
| `CLOUDFLARE_API_TOKEN` | নিচের **সীমিত** অনুমতির টোকেন |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `TELEGRAM_BOT_TOKEN` | @BotFather থেকে |
| `TELEGRAM_CHAT_ID` | তোমার chat id (বটকে মেসেজ দিয়ে `https://api.telegram.org/bot<TOKEN>/getUpdates` খুলে `chat.id` দেখো) |
| `WORKFLOW_PAT` | শুধু Auto Unzip-এর জন্য (`workflow` স্কোপ, শুধু এই রিপো, মেয়াদ সীমিত) |

**Cloudflare টোকেন** (Custom token, "Edit Cloudflare Workers" টেমপ্লেট নয়): Account → *Workers Scripts: Edit*, *Workers KV Storage: Edit*, *Workers AI: Edit*। Zone অনুমতি দিও না। Deploy-এ ৪০৩ এলে Account → *Account Settings: Read* যোগ করো।

## আপডেট করার নিয়ম
রিপোর রুটে নতুন zip আপলোড করলে Auto Unzip খুলে দেয় (zip-এর ভেতরে ফাইল সরাসরি রুটে থাকতে হবে, অতিরিক্ত ফোল্ডার ছাড়া)।

## গুরুত্বপূর্ণ নোট
- **AI মডেল:** `@cf/meta/llama-3.1-8b-instruct` Cloudflare ২০২৬-০৫-৩০ এ বন্ধ করেছে। এখন ডিফল্ট `...-instruct-fp8`; কোনো মডেল বন্ধ হলে কোড নিজে পরেরটায় যায় (`scripts/lib/ai.js` → `DEFAULT_MODELS`)। সব মডেল ফেল করলে monitor Telegram-এ জানাবে।
- **Actions মিনিট:** পাবলিক রিপোতে সীমাহীন। প্রাইভেট রিপোতে ফ্রি ২০০০ মিনিট/মাস, আর এই pipeline তার চেয়ে বেশি খরচ করে — তাই রিপো **পাবলিক** রাখো (কোডে কোনো সিক্রেট নেই), নইলে `update-news.yml`-এর cron ঘণ্টায় একবার করো।
- **Cloudflare ফ্রি সীমা:** KV লেখা ১,০০০/দিন (আমরা ~২০০), পড়া ১,০০,০০০/দিন, Worker রিকোয়েস্ট ১,০০,০০০/দিন, Workers AI ১০,০০০ neurons/দিন (~৪০০+ সামারি)। ব্যবহারকারী বাড়লে রিকোয়েস্ট সীমাই আগে ধরবে।
- নিউজ সোর্স: `config/sources.json`। কোনো ফিড ফেল করলে লগে `FAIL` আর `/health`-এ `feeds.failed` দেখা যায়।
- মডেল-তালিকা: `scripts/update-pricing.js`-এর `INCLUDE_PREFIXES`। প্রিফিক্স না মিললে Telegram আসে।
- লোকাল টেস্ট: `npm test`।
