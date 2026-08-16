/**
 * استنتاج حالة العميل من رد البوت لتحديث عمود «وش صار» تلقائياً
 */
const OUTCOMES = {
  FINANCE_LINK: "أخذ رابط التمويل",
  PACKAGE: "أخذ باقة",
  LIMIT_EXHAUSTED: "مستنفذ حد",
  SERVICE_STOP: "إيقاف خدمات",
  ORDER_NUMBER: "رقم طلب",
};

const AUTO_OUTCOME_LABELS = new Set(Object.values(OUTCOMES));

function detectCustomerOutcome(result) {
  if (!result || typeof result !== "object") return null;

  // العميل أرسل رقم طلب التقديم
  if (result.offer === "order_number_received") {
    return OUTCOMES.ORDER_NUMBER;
  }

  // اختيار مسار إيقاف خدمات من القائمة (أو إكمال خطواته)
  if (
    result.offer === "service_stop" ||
    result.offer === "service_stop_accepted" ||
    result.draft?.step === "awaiting_service_stop_qualify" ||
    result.draft?.step === "awaiting_service_stop_agent"
  ) {
    return OUTCOMES.SERVICE_STOP;
  }

  // قبول الباقة (عقاري + شخصي)
  if (result.offer === "property_combo_accepted") {
    return OUTCOMES.PACKAGE;
  }

  // مسار مستنفذ حد → سؤال عن حلول أخرى
  if (result.offer === "property_combo_interest") {
    return OUTCOMES.LIMIT_EXHAUSTED;
  }

  const reply = String(result.reply || "");
  const followUp = String(result.followUpReply || "");
  const interactiveBody = String(result.interactive?.body || "");
  const blob = `${reply}\n${followUp}\n${interactiveBody}`;

  // رفض شخصي بسبب مستنفذ الحد (حتى بدون عرض باقة)
  if (/مستنفذ\s*حد/.test(blob)) {
    return OUTCOMES.LIMIT_EXHAUSTED;
  }

  // إرسال رابط/رسالة التقديم الإلكتروني للتمويل الشخصي
  if (
    followUp &&
    (/portal\.sfco\.com/i.test(followUp) ||
      /سجل مبلغ التمويل المرغوب/i.test(followUp) ||
      /رابط التقديم/i.test(followUp))
  ) {
    return OUTCOMES.FINANCE_LINK;
  }

  return null;
}

/**
 * هل الملاحظة الحالية من الحالات التلقائية (أو فارغة) فيُسمح بالكتابة فوقها؟
 */
function canAutoUpdateNotes(currentNotes) {
  const notes = String(currentNotes || "").trim();
  return !notes || AUTO_OUTCOME_LABELS.has(notes);
}

/** مفاتيح تبويبات الأدمن → نص «وش صار» */
const OUTCOME_TAB_FILTERS = {
  finance_link: OUTCOMES.FINANCE_LINK,
  order_number: OUTCOMES.ORDER_NUMBER,
  package: OUTCOMES.PACKAGE,
  limit_exhausted: OUTCOMES.LIMIT_EXHAUSTED,
  service_stop: OUTCOMES.SERVICE_STOP,
};

function outcomeLabelForTab(day) {
  const key = String(day || "").trim();
  return OUTCOME_TAB_FILTERS[key] || null;
}

module.exports = {
  OUTCOMES,
  AUTO_OUTCOME_LABELS,
  OUTCOME_TAB_FILTERS,
  outcomeLabelForTab,
  detectCustomerOutcome,
  canAutoUpdateNotes,
};
