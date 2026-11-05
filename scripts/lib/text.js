// ছোট টেক্সট-হেল্পার: HTML ট্যাগ ছাঁটা, এন্টিটি ডিকোড, ছোট করা

const ENT = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    const v = ENT[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function stripHtml(s) {
  return s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function collapse(s) {
  return s.replace(/\s+/g, " ").trim();
}

export function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const i = cut.lastIndexOf(" ");
  const base = i > max * 0.6 ? cut.slice(0, i) : cut;
  return base.replace(/[\s.,;:!?-]+$/, "") + "…";
}

/** ফিডের বাড়তি লেজ ছাঁটা: "Continue reading…", "Read more…", "The post … appeared first on …" */
export function cleanBoilerplate(s) {
  return s
    .replace(/\s*The post\s[\s\S]{0,300}?\sappeared first on\s[\s\S]{0,120}$/i, "")
    .replace(/\s*(?:Continue reading|Read more|Read the full (?:story|article)|Click here to read more)[\s….\u2026]*$/i, "")
    .trim();
}
