/**
 * استخراج نسبة الفائدة من الجلسة — مع احتياط حسب نوع العمل.
 */
const CONFIG = require("../config");

const { jobCategories } = CONFIG;

function resolveJobCategory(session) {
  if (!session) return null;
  // نوع المدني (حكومي/خاص) يغلب مفتاح civilian العام
  if (session.civilianSubtype === "private") return "private";
  if (session.civilianSubtype === "government") return "civilian";
  if (session.jobCategory && jobCategories[session.jobCategory]) {
    return session.jobCategory;
  }
  const label = String(session.jobType || "");
  if (label.includes("عسكري")) return "military";
  if (label.includes("متقاعد")) return "retired";
  if (/خاص/.test(label)) return "private";
  if (label.includes("مدني") || /حكومي/.test(label)) return "civilian";
  return null;
}

/** تمويل شخصي جديد — نسبة الفائدة حسب القطاع (لا تعتمد على قيمة مخزنة قديمة) */
function resolveInterestRate(session) {
  if (!session) return jobCategories.civilian.interestRate;

  const category = resolveJobCategory(session);
  if (category === "private" && jobCategories.private) {
    return jobCategories.private.interestRate;
  }
  if (category === "retired" || category === "civilian") {
    return jobCategories.civilian.interestRate;
  }
  if (category && jobCategories[category]) {
    return jobCategories[category].interestRate;
  }

  return jobCategories.civilian.interestRate;
}

function formatInterestRate(rate) {
  const value = Number(rate);
  if (Number.isNaN(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

/** شراء مديونية — 12% لجميع القطاعات */
function resolveDebtPurchaseInterestRate() {
  return Number(CONFIG.debtPurchase.interestRate) || 12;
}

module.exports = {
  resolveJobCategory,
  resolveInterestRate,
  resolveDebtPurchaseInterestRate,
  formatInterestRate,
};
