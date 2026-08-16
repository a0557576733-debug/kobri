/**
 * قائمة الشركات المعتمدة — بحث بالاسم لاختيار عبر واتساب (حد القائمة 10)
 */
const path = require("path");
const fs = require("fs");

let cache = null;

function loadCompanies() {
  if (cache) return cache;
  const file = path.join(__dirname, "..", "data", "approved-companies.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const companies = (raw.companies || []).map((c, index) => ({
    index,
    name: String(c.name || "").trim(),
    nameEn: c.nameEn ? String(c.nameEn).trim() : "",
    sector: c.sector || null,
  }));
  cache = companies.filter((c) => c.name);
  return cache;
}

function normalizeCompanyText(text) {
  let t = String(text || "")
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // تجاهل بادئة "شركة" للمقارنة
  t = t.replace(/^(شركه|شركة|co|company)\s+/i, "").trim();
  return t;
}

function scoreMatch(queryNorm, company) {
  if (!queryNorm) return 0;
  const nameN = normalizeCompanyText(company.name);
  const enN = normalizeCompanyText(company.nameEn);
  if (!nameN && !enN) return 0;

  let score = 0;
  for (const target of [nameN, enN]) {
    if (!target) continue;
    if (target === queryNorm) score = Math.max(score, 100);
    else if (target.startsWith(queryNorm)) score = Math.max(score, 80);
    else if (target.includes(queryNorm)) score = Math.max(score, 60);
    else if (queryNorm.length >= 4 && queryNorm.includes(target) && target.length >= 4) {
      score = Math.max(score, 50);
    }
  }
  return score;
}

/**
 * ابحث عن شركات مطابقة — أقصى 10 لعرض واتساب
 */
function searchApprovedCompanies(query, { limit = 10 } = {}) {
  const q = normalizeCompanyText(query);
  if (!q || q.length < 2) return [];

  const scored = [];
  for (const company of loadCompanies()) {
    const score = scoreMatch(q, company);
    if (score > 0) scored.push({ ...company, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ar"));
  return scored.slice(0, limit);
}

function getApprovedCompanyCount() {
  return loadCompanies().length;
}

const COMPANY_RESEARCH_ID = "co_research";
const COMPANY_RESEARCH_TITLE = "إعادة البحث عن جهة عملك";

function looksLikeCompanyResearch(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t === COMPANY_RESEARCH_ID) return true;
  if (t === COMPANY_RESEARCH_TITLE) return true;
  return /^(إعادة|اعادة)\s*البحث(\s*عن\s*جهة\s*عملك)?$/i.test(t);
}

function listTitleForCompany(name) {
  const full = String(name || "");
  return full.length <= 24 ? full : `${full.slice(0, 21)}...`;
}

function stripListEllipsis(text) {
  return String(text || "")
    .replace(/\u2026/g, "...")
    .replace(/\.{2,}$/g, "")
    .trim();
}

function companyListInteractive(matches, bodyText) {
  // نترك صف واحد لخيار إعادة البحث (حد واتساب 10)
  const rows = matches.slice(0, 9).map((c, i) => {
    const full = c.name;
    const title = listTitleForCompany(full);
    const rest = full.length > 24 ? full.slice(21) : c.nameEn || "شركة معتمدة";
    return {
      id: `co_${i}`,
      title,
      description: String(rest).slice(0, 72),
    };
  });
  rows.push({
    id: COMPANY_RESEARCH_ID,
    title: COMPANY_RESEARCH_TITLE,
    description: "اكتب اسم الشركة من جديد",
  });
  return {
    kind: "list",
    body: bodyText || "اختر شركتك من النتائج:",
    button: "اختر الشركة",
    sectionTitle: "الشركات المعتمدة",
    rows,
  };
}

function parseCompanyPick(text, matches = []) {
  const t = String(text || "").trim();
  if (!t || looksLikeCompanyResearch(t)) return null;

  const m = t.match(/^co_(\d+)$/i);
  if (m) {
    const idx = Number(m[1]);
    if (Number.isInteger(idx) && matches[idx]) return matches[idx];
  }

  const cleaned = stripListEllipsis(t);
  const cleanedNorm = normalizeCompanyText(cleaned);
  if (!cleanedNorm) return null;

  // مطابقة العنوان كما يظهر في واتساب (مقطوع بـ ...)
  const byListTitle = matches.find(
    (c) =>
      c.listTitle === t ||
      listTitleForCompany(c.name) === t ||
      normalizeCompanyText(stripListEllipsis(c.listTitle || "")) === cleanedNorm
  );
  if (byListTitle) return byListTitle;

  // اسم كامل
  const exact = matches.find(
    (c) =>
      c.name === t ||
      c.name === cleaned ||
      normalizeCompanyText(c.name) === cleanedNorm
  );
  if (exact) return exact;

  // واتساب غالبًا يرسل العنوان المقطوع بدون id → طابق كبادئة
  if (cleanedNorm.length >= 6) {
    const prefixHits = matches.filter((c) => {
      const n = normalizeCompanyText(c.name);
      return n.startsWith(cleanedNorm) || cleanedNorm.startsWith(n);
    });
    if (prefixHits.length === 1) return prefixHits[0];
    // إن أكثر من واحدة، خذ الأقرب طولًا للعنوان
    if (prefixHits.length > 1) {
      prefixHits.sort(
        (a, b) =>
          Math.abs(normalizeCompanyText(a.name).length - cleanedNorm.length) -
          Math.abs(normalizeCompanyText(b.name).length - cleanedNorm.length)
      );
      return prefixHits[0];
    }
  }

  return null;
}

function parseCivilianSubtype(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (
    /^(civilian_gov|civ_gov|gov|government)$/i.test(t) ||
    /حكومي/.test(t) ||
    /^1$/.test(t)
  ) {
    return "government";
  }
  if (
    /^(civilian_private|civ_private|private)$/i.test(t) ||
    /قطاع\s*خاص|خاص/.test(t) ||
    /^2$/.test(t)
  ) {
    return "private";
  }
  return null;
}

function civilianSubtypeButtons() {
  return {
    kind: "buttons",
    body: "مدني — اختر: حكومي أو قطاع خاص",
    buttons: [
      { id: "civilian_gov", title: "حكومي" },
      { id: "civilian_private", title: "قطاع خاص" },
    ],
  };
}

module.exports = {
  loadCompanies,
  normalizeCompanyText,
  searchApprovedCompanies,
  getApprovedCompanyCount,
  companyListInteractive,
  parseCompanyPick,
  listTitleForCompany,
  stripListEllipsis,
  looksLikeCompanyResearch,
  COMPANY_RESEARCH_ID,
  COMPANY_RESEARCH_TITLE,
  parseCivilianSubtype,
  civilianSubtypeButtons,
};
