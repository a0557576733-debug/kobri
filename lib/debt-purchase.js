/**
 * حسبة شراء المديونية
 *
 * 1) نسبة الاستقطاع حسب العقاري (45% / 55% / 65%)
 * 2) المتبقي الشهري = (الدخل × النسبة) − الالتزامات
 * 3) أعلى مبلغ متاح من المتبقي بمعادلة القسط + فائدة القطاع الشخصية
 * 4) إذا أعلى مبلغ >= مبلغ المديونية → مؤهل
 *    الفائض = أعلى مبلغ − مبلغ المديونية
 * 5) القسط المعروض على الإجمالي بفائدة شراء المديونية 12%
 */
const CONFIG = require("../config");
const {
  calculateMonthlyInstallment,
  formatMoney,
} = require("./calculations");
const {
  resolveInterestRate,
  resolveDebtPurchaseInterestRate,
} = require("./interest-rate");

const { ratios } = CONFIG.calculation;
const loanTermMonths = CONFIG.financing?.loanTermMonths || 60;

function getDeductionRatio(realEstateType) {
  if (realEstateType === "supported") return ratios.supported;
  if (realEstateType === "unsupported" || realEstateType === "old") {
    return ratios.unsupported;
  }
  return ratios.none;
}

function calculateMonthlyCapacity({
  realEstateType,
  salary,
  commitments,
  supportAmount = 0,
}) {
  const ratio = getDeductionRatio(realEstateType);
  let income = Number(salary) || 0;
  if (realEstateType === "supported") {
    income += Number(supportAmount) || 0;
  }
  return income * ratio - Number(commitments || 0);
}

/**
 * عكس معادلة القسط:
 * قسط = مبلغ/60 + مبلغ×نسبة/12
 * ⇒ مبلغ = قسط / (1/60 + نسبة/12)
 */
function calculateMaxAmountFromMonthlyCapacity(
  monthlyCapacity,
  annualRatePercent,
  months = loanTermMonths
) {
  const cap = Number(monthlyCapacity);
  const annual = Number(annualRatePercent) / 100;
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  const denom = 1 / months + annual / 12;
  if (!denom || denom <= 0) return 0;
  // للأقل (محافظ) مثل مثال 52,173
  return Math.floor(cap / denom);
}

/**
 * @param {{
 *   debtAmount: number,
 *   jobCategory: string,
 *   salary: number,
 *   commitments: number,
 *   realEstateType?: string,
 *   supportAmount?: number,
 * }} input
 */
function calculateDebtPurchaseOffer(input) {
  const debtAmount = Number(input.debtAmount);
  if (!Number.isFinite(debtAmount) || debtAmount <= 0) {
    return {
      ok: false,
      reply:
        CONFIG.messages?.invalidDebtPurchaseAmount ||
        `الرجاء كتابة مبلغ شراء المديونية بالأرقام فقط.

مثال:
20000`,
    };
  }

  const jobCategory = input.jobCategory || "civilian";
  const realEstateType = input.realEstateType || "none";
  const salary = Number(input.salary);
  const commitments = Number(input.commitments);
  const supportAmount = Number(input.supportAmount || 0);

  const ratio = getDeductionRatio(realEstateType);
  const monthlyCapacity = calculateMonthlyCapacity({
    realEstateType,
    salary,
    commitments,
    supportAmount,
  });

  if (!Number.isFinite(monthlyCapacity) || monthlyCapacity <= 0) {
    return {
      ok: false,
      reply: "نعتذر منك التزامك عالي حسب نسبة الاستقطاع المتاحة.",
      data: { monthlyCapacity, ratio },
    };
  }

  const personalRate = resolveInterestRate({ jobCategory });
  const maxAmount = calculateMaxAmountFromMonthlyCapacity(
    monthlyCapacity,
    personalRate
  );

  if (maxAmount < debtAmount) {
    return {
      ok: false,
      reply: `نعتذر منك، حسب بياناتك أعلى مبلغ متاح لك ${formatMoney(maxAmount)} ريال، وهو أقل من مبلغ شراء المديونية ${formatMoney(debtAmount)} ريال.`,
      data: {
        monthlyCapacity,
        ratio,
        personalRate,
        maxAmount,
        debtAmount,
      },
    };
  }

  const surplus = maxAmount - debtAmount;
  const total = debtAmount + surplus; // = maxAmount
  const debtRate = resolveDebtPurchaseInterestRate();
  const installment = calculateMonthlyInstallment(
    total,
    debtRate,
    undefined,
    jobCategory
  );

  const offerFn = CONFIG.templates?.debtPurchaseOffer;
  const offerText =
    typeof offerFn === "function"
      ? offerFn(
          formatMoney(debtAmount),
          formatMoney(surplus),
          formatMoney(installment)
        )
      : `سداد المديونية: ${formatMoney(debtAmount)} ريال
الفائض الشخصي: ${formatMoney(surplus)} ريال

القسط الشهري (على الإجمالي): ${formatMoney(installment)} ريال`;

  const continueQ =
    CONFIG.messages?.debtContinueQuestion ||
    `هل تبي تكمل إجراءات شراء المديونية؟`;

  // النص: العرض + السؤال — بدون 1/2 لأن الخيارات من الأزرار فقط
  const reply = `${offerText}

${continueQ}`;

  return {
    ok: true,
    offer: "debt_purchase",
    reply,
    interactive: {
      kind: "buttons",
      body: reply,
      buttons: [
        { id: "debt_yes", title: "نعم" },
        { id: "debt_no", title: "لا" },
      ],
    },
    data: {
      flow: "debt_chat",
      jobCategory,
      salary,
      commitments,
      realEstateType,
      supportAmount,
      ratio,
      monthlyCapacity,
      personalRate,
      maxAmount,
      debtAmount,
      surplus,
      total,
      rate: debtRate,
      installment,
      awaitingDebtContinue: true,
    },
  };
}

function buildDebtPurchaseComplete() {
  const fin = CONFIG.financing || {};
  const completeFn = CONFIG.templates?.debtPurchaseComplete;
  const employeeName =
    fin.debtPurchaseAgentName || fin.branchEmployeeName || "ماجد";
  const employeePhone =
    fin.debtPurchaseAgentPhone || fin.branchEmployeePhone || "0507009290";
  const portalUrl =
    fin.portalUrl || "https://portal.sfco.com.sa/?DSA=SF1888";
  const letterCompany =
    CONFIG.debtPurchase?.letterCompanyExample || "إمكان";

  const reply =
    typeof completeFn === "function"
      ? completeFn(employeeName, employeePhone, portalUrl, letterCompany)
      : `لإكمال طلب شراء المديونية:

تواصل مع الموظف ${employeeName}:
${employeePhone}

يرجى إحضار خطاب شراء مديونية (مثال: من شركة ${letterCompany})

رابط التقديم الإلكتروني:
${portalUrl}`;

  return { ok: true, offer: "debt_purchase_accepted", reply };
}

function buildDebtPurchaseDeclined() {
  return {
    ok: true,
    offer: "debt_purchase_declined",
    reply:
      CONFIG.messages?.debtDeclined ||
      "شكراً لتواصلك. إذا رغبت لاحقاً اكتب: مرحبا",
  };
}

function looksLikeDebtContinueReply(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 40) return null;
  if (/^(1|نعم|اي|أي|أجل|موافق|ابي|أبي|أرغب|ارغب|debt_yes|yes)$/i.test(t)) {
    return "yes";
  }
  if (/^(2|لا|لأ|لاء|ما ابي|ماأبي|رفض|debt_no|no)$/i.test(t)) return "no";
  return null;
}

module.exports = {
  calculateDebtPurchaseOffer,
  buildDebtPurchaseComplete,
  buildDebtPurchaseDeclined,
  looksLikeDebtContinueReply,
  getDeductionRatio,
  calculateMonthlyCapacity,
  calculateMaxAmountFromMonthlyCapacity,
};
