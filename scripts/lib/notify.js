// Telegram বটে সতর্কতা পাঠানো। TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID না থাকলে চুপচাপ বাদ (কখনো ক্র্যাশ করে না)

export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.warn("Telegram সেট করা নেই (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) — সতর্কতা শুধু লগে:", text);
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: String(text).slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`Telegram পাঠানো ব্যর্থ: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("Telegram পাঠানো ব্যর্থ:", String((e && e.message) || e));
    return false;
  }
}
