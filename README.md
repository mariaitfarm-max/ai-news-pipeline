# AI News — Backend (GitHub Actions + Cloudflare Workers)

```
GitHub Actions (cron)  ──►  Cloudflare KV  ──►  Cloudflare Worker  ──►  Android অ্যাপ
 • প্রতি ৩০ মিনিট: RSS → /api/news
 • প্রতিদিন: OpenRouter → /api/model-pricing
 • নতুন খবরের ২ বাক্যের AI সামারি: Cloudflare Workers AI (ফ্রি অ্যালাউয়েন্স)
```

সব কোড ও কনফিগ এই রিপোতে। Cloudflare থেকে শুধু **২টা জিনিস** আনতে হয়, GitHub Secrets-এ বসাতে হয়।

## একবারের সেটআপ

### ১) Cloudflare থেকে যা আনবেন
1. dash.cloudflare.com-এ ফ্রি অ্যাকাউন্ট খুলুন।
2. **Account ID**: Workers & Pages পেজের ডান পাশে (বা ব্রাউজার URL-এর `dash.cloudflare.com/<এই অংশটা>/...`)।
3. **API Token**: Profile → API Tokens → Create Token → টেমপ্লেট **"Edit Cloudflare Workers"**
   → Account Resources: আপনার অ্যাকাউন্ট, Zone Resources: All zones → Create → টোকেন কপি করুন (একবারই দেখাবে)।

### ২) GitHub-এ কী নামে রাখবেন
রিপো → Settings → Secrets and variables → Actions → **New repository secret**

| Name (হুবহু) | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | ধাপ ১-এর টোকেন |
| `CLOUDFLARE_ACCOUNT_ID` | ধাপ ১-এর Account ID |

(`WORKFLOW_PAT` আগেরটাই থাকবে — unzip-এর জন্য। `DATA_REPO_TOKEN` আর লাগবে না।)

### ৩) ফাইল তোলা
`ai-news-backend-v2.zip` রিপোর রুটে আপলোড করুন। Auto Unzip নিজেই খুলে দেবে, তারপর
**Deploy API (Cloudflare Worker)** নিজে থেকে চলবে। ধাপ ২ আগে শেষ করুন, নইলে এটা ফেল করবে
(ফেল করলে Actions → Deploy API → Run workflow চাপুন)।

### ৪) ফলাফল দেখা
Actions → **Deploy API** সবুজ হলে Summary-তে URL পাবেন (ফাইলেও: `status/backend-url.txt`)।
ব্রাউজারে `<URL>/health` খুলে দেখুন `"ok":true` আর news/pricing-এ count আছে কিনা।

### ৫) অ্যাপে URL বসানো
`ApiConfig.kt`-এর `BACKEND_BASE_URL`-এ ওই URL দিন (শেষে `/` রেখে), তারপর অ্যাপ রিবিল্ড।

## AI সামারি চালু করা (একবার)
API Token-এ Workers AI-র অনুমতি যোগ করতে হবে (টোকেনের মান বদলায় না, GitHub Secret ছোঁয়ার দরকার নেই):
Cloudflare → My Profile → API Tokens → আপনার টোকেনের পাশে **Edit** → Permissions → Add more →
**Account → Workers AI → Edit** → Continue to summary → Update Token।

- শুধু নতুন খবরের সামারি বানানো হয় (প্রতি রানে সর্বোচ্চ ১৫টা), আগেরগুলো `summaries` কী-তে ক্যাশ থাকে। প্রথমে নতুন খবর থেকে শুরু হয়, তাই পুরো ফিড ভরতে কয়েক ঘণ্টা লাগতে পারে।
- সামারি শিরোনাম + ফিডের অংশবিশেষ থেকে বানানো, মূল আর্টিকেলের পুরো লেখা থেকে না।
- অনুমতি না থাকলে বা ফ্রি সীমা শেষ হলে workflow ফেল হয় না; লগে `AI ব্যর্থ` লাইন আসে আর অ্যাপ সোর্সের description দেখায়।
- বন্ধ করতে: `update-news.yml`-এর `env`-এ `AI_SUMMARIES: "off"` দিন। মডেল বদলাতে `AI_MODEL`
  (Cloudflare-এর মডেল তালিকা বদলায়, তাই কোনোদিন মডেল বন্ধ হলে এটা বদলাবেন)।

## প্রতিদিনের কাজ — কিছুই না
- নিউজ: প্রতি ৩০ মিনিটে, প্রাইসিং: প্রতিদিন। কোনো workflow ফেল করলে GitHub আপনাকে ইমেইল করবে।
- নিউজ সোর্স বদলাতে `config/sources.json` এডিট করুন (name, url, filter)।
  `filter: true` মানে শুধু AI-সম্পর্কিত আইটেম রাখা হবে।
- মডেল লিস্ট বদলাতে `scripts/update-pricing.js`-এর `INCLUDE_PREFIXES`।
- Actions → Update AI News → Run workflow দিয়ে যেকোনো সময় হাতে চালানো যায়; লগে প্রতিটা ফিডের `OK`/`FAIL` দেখা যায়।

## সমস্যা হলে
| লক্ষণ | কারণ / সমাধান |
|---|---|
| Deploy: "CLOUDFLARE_API_TOKEN ... সেট করা নেই" | ধাপ ২-এর secret নাম/মান ঠিক নেই |
| Deploy: subdomain অটো-তৈরি হয়নি | Cloudflare → Workers & Pages একবার খুলুন, তারপর Run workflow |
| Deploy: 403 / Authentication error | টোকেনে "Edit Cloudflare Workers" টেমপ্লেট নেই, বা ভুল অ্যাকাউন্ট বাছা |
| `/api/news` → 503 data_not_ready | Update AI News একবার Run workflow করুন |
| লগে "AI ব্যর্থ ... 403 Authentication error" | টোকেনে Workers AI: Edit যোগ করুন (উপরের ধাপ) |
| লগে "AI ব্যর্থ" অন্য এরর | মডেলের নাম বদলে থাকতে পারে — `AI_MODEL` বদলান |
| News: "কমপক্ষে ৮টা দরকার" | বেশিরভাগ ফিড FAIL — লগ দেখে `config/sources.json`-এর URL ঠিক করুন |

## খরচ ও সীমা (ফ্রি)
Workers Free: দিনে ১ লাখ রিকোয়েস্ট; KV Free: দিনে ১ লাখ রিড, ১০০০ রাইট (আমরা দিনে ~৫০ লিখি)।
অ্যাপ ১৫ মিনিট ক্যাশ রাখে আর Worker ৫ মিনিটের `Cache-Control` দেয়, তাই সীমা অনেক ইউজার পর্যন্ত যথেষ্ট।
এখনকার সীমা Cloudflare-এর ডকুমেন্টেশনে দেখে নিন।

## পরে অ্যাডস/সাবস্ক্রিপশন যোগ করলে
ব্যাকএন্ডে কিছু বদলাতে হবে না। দরকার হলে Cloudflare Workers Paid প্ল্যান ($5/মাস), অ্যাপে SDK/Billing,
আর প্রাইভেসি পলিসি ও Play Data safety আপডেট।

## প্রাইভেসি পলিসি (Play Store-এর জন্য)
`docs/index.html`-এ `YOUR_EMAIL_HERE` বদলে নিজের ইমেইল দিন। তারপর রিপো → Settings → Pages →
Branch `main`, Folder `/docs` → Save। URL হবে `https://<ইউজারনেম>.github.io/<রিপো>/`। এটাই Play Console-এ দেবেন।

## লোকালি টেস্ট (ঐচ্ছিক)
`npm test` — পার্সারের টেস্ট। `OUTPUT_DIR=out node scripts/update-news.js` — KV-র বদলে ফাইলে লেখে।
