/**
 * استخراج نص رسالة العميل من Webhook Interakt
 * مهم: ضغط زر Quick Reply قد يوصل button_text منفصل عن message
 * (و message أحيانًا يكون نص الرسالة الأصلية أو JSON)
 */
const { normalizeDigits } = require("./digits");

function asTrimmedString(value) {
  if (value == null) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function normalizeIncomingText(text) {
  return String(text || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[➦►▶➢➤•·●○▪️]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function looksLikeJsonBlob(text) {
  const t = String(text || "").trim();
  return (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  );
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * أولوية عنوان الزر/القائمة قبل أي message عام
 */
function pickInteractiveLabel(messageObj = {}) {
  const meta = messageObj.meta_data || messageObj.metadata || {};
  const sourceData = meta.source_data || {};
  const interactive =
    messageObj.interactive ||
    meta.interactive ||
    messageObj.raw_interactive ||
    {};
  const buttonReply =
    messageObj.button_reply ||
    interactive.button_reply ||
    meta.button_reply ||
    {};
  const listReply =
    messageObj.list_reply ||
    interactive.list_reply ||
    meta.list_reply ||
    {};
  const buttonPayload = messageObj.button_payload || meta.button_payload || {};
  const payloadInner =
    buttonPayload.payload ||
    (typeof buttonPayload === "object" ? buttonPayload : {}) ||
    {};

  // معرفاتنا الداخلية أوضح من العنوان المقطوع (خصوصًا قائمة الشركات co_0)
  const knownIds = [
    listReply.id,
    buttonReply.id,
    payloadInner.id,
    messageObj.button_text,
    messageObj.button,
  ];
  for (const c of knownIds) {
    const s = asTrimmedString(c);
    if (
      s &&
      /^(co_\d+|co_research|ex_\d+|ex_more(?:_\d+)?|amt_\d+|re_|civilian|military|retired|combo_|civ_)/i.test(
        s
      )
    ) {
      return s;
    }
  }

  const priority = [
    messageObj.button_text,
    messageObj.button_title,
    buttonReply.title,
    listReply.title,
    payloadInner.text,
    buttonPayload.text,
    meta.button_text,
    meta.button_title,
    sourceData.button_text,
    messageObj.button,
    buttonReply.id,
    listReply.id,
    payloadInner.id,
  ];

  for (const c of priority) {
    const s = asTrimmedString(c);
    if (!s || looksLikeJsonBlob(s)) continue;
    return s;
  }
  return "";
}

/**
 * ابحث في الشجرة عن button_reply.title / list_reply.title / button_text
 */
function deepFindInteractiveLabel(node, depth = 0) {
  if (node == null || depth > 6) return "";
  if (typeof node === "string") {
    const parsed = looksLikeJsonBlob(node) ? tryParseJson(node) : null;
    if (parsed) return deepFindInteractiveLabel(parsed, depth + 1);
    return "";
  }
  if (typeof node !== "object") return "";

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindInteractiveLabel(item, depth + 1);
      if (found) return found;
    }
    return "";
  }

  const direct =
    asTrimmedString(node.button_text) ||
    asTrimmedString(node.button_title) ||
    asTrimmedString(node?.button_reply?.title) ||
    asTrimmedString(node?.list_reply?.title) ||
    asTrimmedString(node?.payload?.text);
  if (direct && !looksLikeJsonBlob(direct)) return direct;

  for (const key of Object.keys(node)) {
    // لا نستخدم نص الرسائل الصادرة الطويل كـ label
    if (key === "raw_template" || key === "message" || key === "body") continue;
    const found = deepFindInteractiveLabel(node[key], depth + 1);
    if (found) return found;
  }
  return "";
}

function pickPlainMessageText(messageObj = {}) {
  const candidates = [
    messageObj.message,
    messageObj.text,
    messageObj.body,
    messageObj.title,
  ];
  for (const c of candidates) {
    const s = asTrimmedString(c);
    if (!s || looksLikeJsonBlob(s)) continue;
    // تجاهل JSON المتداخل كنص طويل غير مفيد
    if (s.length > 200 && !/مدني|متقاعد|عسكري|تمويل/.test(s)) continue;
    return s;
  }

  // message قد يكون JSON فيه title الزر
  for (const c of candidates) {
    const s = asTrimmedString(c);
    if (!s || !looksLikeJsonBlob(s)) continue;
    const parsed = tryParseJson(s);
    const nested = deepFindInteractiveLabel(parsed);
    if (nested) return nested;
  }
  return "";
}

function extractChoiceFromMultiline(text) {
  if (!text.includes("\n")) return text;
  const lines = text
    .split("\n")
    .map((l) => normalizeIncomingText(l))
    .filter(Boolean);
  const last = lines[lines.length - 1] || "";
  if (
    /^(مدني|متقاعد|عسكري|[1-4]|لا يوجد|مدعوم|غير مدعوم|قديم|نعم|لا|civilian|retired|military)$/i.test(
      last
    )
  ) {
    return last;
  }
  // ابحث عن سطر قصير فيه القطاع
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/مدني|متقاعد|عسكري|civilian|retired|military/i.test(lines[i])) {
      return lines[i];
    }
  }
  return text;
}

function extractIncomingMessage(payload) {
  const data = payload?.data || payload;
  const messageObj = data?.message || {};
  const customer = data?.customer || {};

  let text =
    pickInteractiveLabel(messageObj) ||
    deepFindInteractiveLabel(messageObj) ||
    deepFindInteractiveLabel(data) ||
    pickPlainMessageText(messageObj) ||
    asTrimmedString(data?.text) ||
    "";

  text = normalizeIncomingText(text);
  text = normalizeDigits(text);
  text = extractChoiceFromMultiline(text);

  let phone =
    customer?.phone_number ||
    customer?.phoneNumber ||
    customer?.trailing_phone ||
    customer?.channel_phone_number ||
    data?.customer_number ||
    "";
  let countryCode =
    customer?.country_code || customer?.countryCode || "+966";

  phone = String(phone).replace(/\D/g, "");
  if (phone.startsWith("966") && phone.length > 9) {
    phone = phone.slice(3);
  }
  if (phone.startsWith("0")) phone = phone.slice(1);
  if (phone.length > 9 && phone.startsWith("966")) {
    phone = phone.slice(3);
  }

  countryCode = String(countryCode || "+966");
  if (!countryCode.startsWith("+")) countryCode = `+${countryCode}`;

  // workflow_response_update: رقم كامل مثل +9665...
  if (!phone && data?.customer_number) {
    const full = String(data.customer_number).replace(/\D/g, "");
    if (full.startsWith("966") && full.length > 9) {
      phone = full.slice(3);
      countryCode = "+966";
    }
  }

  return {
    text: String(text || ""),
    phone,
    countryCode,
    contentType: messageObj.message_content_type || messageObj.type || "",
    eventType: payload?.type || payload?.event || "",
  };
}

module.exports = {
  normalizeIncomingText,
  pickInteractiveLabel,
  extractIncomingMessage,
};
