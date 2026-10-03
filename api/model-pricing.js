// api/model-pricing.js
//
// এই Vercel ফাংশনটাই সেই "মাঝের লোক" যেটা প্রাইভেট GitHub রিপো আর Android
// অ্যাপের মাঝে দরকার। কেন দরকার: প্রাইভেট রিপো পড়তে একটা GitHub token
// লাগে — সেই token সরাসরি Android অ্যাপে রাখলে APK ডিকম্পাইল করে যে কেউ
// টোকেনটা বের করে ফেলতে পারবে। এই ফাংশনটা টোকেনটা সার্ভার-সাইডে (Vercel-এর
// Environment Variable হিসেবে) নিরাপদে রাখে, অ্যাপের কাছে কখনো পাঠায় না —
// অ্যাপ শুধু এই পাবলিক URL-টা কল করে, কোনো সিক্রেট ছাড়াই।

export default async function handler(req, res) {
  const owner = process.env.GITHUB_DATA_OWNER;
  const repo = process.env.GITHUB_DATA_REPO;
  const token = process.env.GITHUB_DATA_TOKEN;
  const filePath = "model-pricing.json";

  if (!owner || !repo || !token) {
    return res.status(500).json({
      error: "সার্ভার মিসকনফিগার্ড — GITHUB_DATA_OWNER/REPO/TOKEN env variable সেট করা হয়নি",
    });
  }

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!ghRes.ok) {
      return res.status(502).json({
        error: `GitHub থেকে ডেটা আনা যায়নি (কোড ${ghRes.status}) — টোকেন/রিপো নাম ঠিক আছে কিনা চেক করো`,
      });
    }

    const file = await ghRes.json();
    const content = Buffer.from(file.content, "base64").toString("utf-8");
    const data = JSON.parse(content);

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "সার্ভার এরর: " + String(err.message || err) });
  }
}
