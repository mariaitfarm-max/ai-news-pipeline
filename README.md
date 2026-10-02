# AI News — Pricing/Comparison Data Pipeline

GitHub Actions দিয়ে প্রতিদিন একবার OpenRouter-এর ফ্রি পাবলিক API থেকে বড়
AI মডেলগুলোর দাম, context window, আর intelligence benchmark টেনে, একটা
প্রাইভেট রিপোতে JSON হিসেবে সেভ রাখে — সাথে "শেষ কবে আপডেট হয়েছে" টাইমস্ট্যাম্প।

## এটা কীভাবে কাজ করে
```
এই রিপো (public + Vercel দুটোর সোর্সই একসাথে)
  .github/workflows/update-model-pricing.yml  — প্রতিদিন একবার ট্রিগার হয়
  scripts/fetch-pricing.js                      — OpenRouter থেকে টানে, ফিল্টার করে
  api/model-pricing.js                           — Vercel ফাংশন, প্রাইভেট রিপো থেকে পড়ে অ্যাপকে দেয়

        │  (GitHub Action রান হয়, প্রতিদিন)
        ▼

প্রাইভেট রিপো (ai-news-data) — শুধু ডেটা থাকে
  model-pricing.json   — { last_updated, models: [...] }

        │  (অ্যাপ যখনই রিকোয়েস্ট করে, তখনই — cache 1 ঘণ্টা)
        ▼

Vercel (এই রিপো থেকেই ডিপ্লয় হয়)  →  Android অ্যাপ (ModelComparisonActivity)
```

## সেটআপ ধাপে ধাপে

**১. একটা প্রাইভেট রিপো বানাও** (যেমন `ai-news-data`) — এখানে শুধু ডেটা
জমা হবে, কোড না। খালি রাখলেই হবে, প্রথম রানেই `model-pricing.json` তৈরি
হয়ে যাবে।

**২. একটা Fine-grained Personal Access Token বানাও**
GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token
- Repository access: শুধু `ai-news-data` রিপোটা বেছে নাও (সব রিপো না)
- Permissions: Contents → Read and write

**৩. এই (কোড) রিপোতে টোকেনটা সিক্রেট হিসেবে যোগ করো**
এই রিপো → Settings → Secrets and variables → Actions → New repository secret
- Name: `DATA_REPO_TOKEN`
- Value: ধাপ ২-এর টোকেন

**৪. workflow ফাইলে ইউজারনেম বসাও**
`.github/workflows/update-model-pricing.yml`-এ
`YOUR_USERNAME/ai-news-data`-এর জায়গায় নিজের GitHub ইউজারনেম বসাও।

**৫. প্রথমবার ম্যানুয়ালি টেস্ট করো**
এই রিপো → Actions ট্যাব → "Update AI Model Pricing" → "Run workflow" বাটন।
সফল হলে `ai-news-data` রিপোতে `model-pricing.json` ফাইলটা তৈরি হয়ে যাবে।
এরপর থেকে এটা প্রতিদিন রাত ৩টা UTC-তে (বাংলাদেশ সময় সকাল ৯টা) নিজে থেকে চলবে।

## Vercel সেটআপ (api/model-pricing.js ডিপ্লয় করা)

**১. vercel.com-এ GitHub দিয়ে সাইনআপ করো** (ফ্রি, কার্ড লাগে না)

**২. "Add New Project" → এই রিপোটা import করো**
Vercel নিজে থেকেই `api/` ফোল্ডারটা চিনে নেবে, আলাদা কনফিগ লাগবে না।

**৩. একটা নতুন, শুধু READ-অনুমতির টোকেন বানাও** (ধাপ ২-এর token-টা আলাদা
রাখা ভালো — GitHub Actions-এর write access লাগে, কিন্তু Vercel-এর শুধু
read লাগে; আলাদা টোকেন রাখলে কোনো একটা ফাঁস হলেও ক্ষতি কম হবে)
- Fine-grained token, শুধু `ai-news-data` রিপোতে অ্যাক্সেস
- Permissions: Contents → **Read-only**

**৪. Vercel প্রজেক্টে Environment Variables যোগ করো**
Project → Settings → Environment Variables:
- `GITHUB_DATA_OWNER` = তোমার GitHub ইউজারনেম
- `GITHUB_DATA_REPO` = `ai-news-data`
- `GITHUB_DATA_TOKEN` = ধাপ ৩-এর read-only টোকেন

**৫. Deploy চাপো, তারপর টেস্ট করো**
ডিপ্লয় শেষে একটা URL পাবে (যেমন `https://ai-news-backend.vercel.app`)।
ব্রাউজারে `https://তোমার-প্রজেক্ট.vercel.app/api/model-pricing` খুলে
JSON রেসপন্স আসছে কিনা দেখো।

**৬. Android অ্যাপে এই URL বসাও**
`app/src/main/java/com/ainews/app/network/ApiConfig.kt`-এ
`BACKEND_BASE_URL`-এর মান বদলে তোমার Vercel URL বসাও (শেষে `/` সহ)।
Discover ট্যাবে এখন "Compare AI Models" কার্ড থেকে এই ডেটা দেখা যাবে,
`last_updated` তারিখ-সহ।

## আউটপুট ফরম্যাট (`model-pricing.json`)
```json
{
  "last_updated": "2026-09-29T03:00:12.000Z",
  "source": "https://openrouter.ai/api/v1/models",
  "model_count": 11,
  "models": [
    {
      "id": "google/gemini-3.8-flash",
      "name": "Google: Gemini 3.8 Flash",
      "provider": "google",
      "input_price_per_million_usd": 0.75,
      "output_price_per_million_usd": 3.75,
      "is_free": false,
      "context_length": 1048576,
      "intelligence_index": 40.9,
      "coding_index": 76.3,
      "input_modalities": ["text", "image", "video", "file", "audio"]
    }
  ]
}
```
অ্যাপে "শেষ আপডেট: [তারিখ]" দেখাতে `last_updated` ফিল্ডটাই ব্যবহার করবে।

## কোন মডেল দেখাবে সেটা নিয়ন্ত্রণ
`scripts/fetch-pricing.js`-এর ওপরের দিকে `INCLUDE_PREFIXES` লিস্টটা
এডিট করো। OpenRouter-এ ৪০০+ মডেল আছে — সবগুলো দেখানো অ্যাপে কাজের না, তাই
এখানে বড় প্রোভাইডারদের ফ্ল্যাগশিপ মডেলগুলো বেছে রাখা হয়েছে। নতুন গুরুত্বপূর্ণ
মডেল এলে এই লিস্টে যোগ করতে হবে — এটা স্বয়ংক্রিয়ভাবে "সব নতুন মডেল" ধরবে না,
ইচ্ছাকৃতভাবে কিউরেটেড রাখা হয়েছে।

## ৬০ দিনের নিষ্ক্রিয়তার ব্যাপারে
GitHub স্বয়ংক্রিয়ভাবে scheduled workflow বন্ধ করে দেয় যদি এই (কোড) রিপোতে
৬০ দিন কোনো কমিট না পড়ে। এটা ঠেকাতে workflow-টা প্রতিবার চলার সময় এই রিপোতেই
একটা ছোট `status/last-run.txt` কমিট করে — তাই আলাদা কিছু করা লাগবে না, এটা
নিজে থেকেই সবসময় সক্রিয় থাকবে।

## Vercel নিয়ে একটা গুরুত্বপূর্ণ নোট
তোমরা আগে আলোচনা করেছিলে অ্যাপে বিজ্ঞাপন/সাবস্ক্রিপশন রাখার কথা — সেটা মাথায়
রেখে: Vercel-এর Hobby (ফ্রি) প্ল্যান তাদের নিজস্ব শর্তানুযায়ী **শুধু ব্যক্তিগত,
অ-বাণিজ্যিক ব্যবহারের জন্য**। অ্যাপে বিজ্ঞাপন বা পেইড সাবস্ক্রিপশন যোগ করলে
সেটা "commercial use" হিসেবে গণ্য হয়, তখন Vercel Pro ($20/মাস থেকে শুরু)
লাগবে। ডেভেলপমেন্ট/টেস্টিং পর্যায়ে Hobby দিয়ে শুরু করাই ঠিক আছে, শুধু এই
সীমাটা মাথায় রেখো যখন মনিটাইজেশন যোগ করবে।

## পরের ধাপ
এই ডেটা এখন প্রাইভেট রিপোতে বসছে, আর Vercel ফাংশন/Android স্ক্রিনও লেখা
হয়ে গেছে (নিচে সেটআপ দেখো)। এখন বাকি:
1. একই প্যাটার্নে খবরের জন্যও (২০-৩০ মিনিট পরপর, NewsAPI চেক করে) আরেকটা
   workflow — কাঠামো প্রায় একই থাকবে
2. প্রকৃত LLM সামারাইজেশন ব্যাকএন্ড (এখনো বাকি, আলাদা আলোচনা)
