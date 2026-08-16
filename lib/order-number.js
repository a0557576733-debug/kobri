/**
 * رقم طلب التقديم الإلكتروني — يبدأ بـ 101 ويتكون من 8 أرقام
 */
const { normalizeDigits } = require("./digits");

const ORDER_PREFIX = "101";
const ORDER_DIGITS = 8;
const ORDER_NUMBER_RE = /^101\d{5}$/;

function extractOrderCandidate(raw) {
  const digitsOnly = String(raw || "").replace(/\D/g, "");
  if (ORDER_NUMBER_RE.test(digitsOnly)) return digitsOnly;

  // «رقم الطلب: 101xxxxx» داخل نص أطول
  const labeled = String(raw || "").match(
    /(?:رقم\s*الطلب|طلب(?:ي)?)\s*[:：\-]?\s*(101\d{5})\b/i
  );
  if (labeled) return labeled[1];

  const embedded = String(raw || "").match(/\b(101\d{5})\b/);
  if (embedded) return embedded[1];

  return null;
}

function parseApplicationOrderNumber(text) {
  const raw = normalizeDigits(String(text || "")).trim();
  if (!raw) return null;

  const candidate = extractOrderCandidate(raw);
  if (!candidate || !ORDER_NUMBER_RE.test(candidate)) return null;

  const digitsOnly = raw.replace(/\D/g, "");
  // الرسالة كلها الرقم، أو رقم الطلب مع كلمات خفيفة، أو الرقم مضمّن بعد تسمية
  if (digitsOnly === candidate) {
    const withoutDigits = raw
      .replace(/\d/g, "")
      .replace(/[^\u0600-\u06FFa-zA-Z]/g, "");
    const allowedWords = /^(رقم|الطلب|طلبي|طلب)?$/i;
    if (!withoutDigits || allowedWords.test(withoutDigits)) {
      return candidate;
    }
  }

  if (
    /(?:رقم\s*الطلب|طلب(?:ي)?)/i.test(raw) &&
    digitsOnly.includes(candidate)
  ) {
    return candidate;
  }

  // رقم 8 خانات وحده في الرسالة
  if (digitsOnly === candidate) return candidate;

  return null;
}

function looksLikeApplicationOrderNumber(text) {
  return parseApplicationOrderNumber(text) != null;
}

function buildOrderNumberAckReply(configMessages = {}) {
  const custom = configMessages.orderNumberRecorded;
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  return `تم استلام رقم الطلب
سيتم الرد في أقرب وقت ممكن 
لمتابعة الطلب  ارسل رقم الطلب إلى 
 عبدالرحمن 
0595243553`;
}

module.exports = {
  ORDER_PREFIX,
  ORDER_DIGITS,
  ORDER_NUMBER_RE,
  parseApplicationOrderNumber,
  looksLikeApplicationOrderNumber,
  buildOrderNumberAckReply,
};
