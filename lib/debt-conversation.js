/**
 * محادثة شراء مديونية خطوة بخطوة عبر الكوبري
 * المسار: قطاع → راتب → عقاري → التزامات → مبلغ المديونية → عرض → إكمال
 */
const CONFIG = require("../config");
const { mapSector } = require("./personal-finance");
const { meetsMinimumSalary } = require("./calculations");
const {
  calculateDebtPurchaseOffer,
  buildDebtPurchaseComplete,
  buildDebtPurchaseDeclined,
  looksLikeDebtContinueReply,
} = require("./debt-purchase");
const {
  parseSalaryReply,
  salaryPrompt,
  invalidSalaryPrompt,
  lowSalaryApology,
  realEstateStepReply,
  parseRealEstateChoice,
  realEstateInteractive,
  afterSectorSelected,
  advanceCivilianSubtypeFlow,
} = require("./conversation");

function looksLikeStartDebtPurchase(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.length > 80) return false;
  // لا نستخدم "2" وحده — يتعارض مع خيارات العقاري/نعم-لا
  return /^(شراء مديونية|شراء المديونية|شراء مديونية الشركات|مديونية الشركات|ابي شراء مديونية|أبي شراء مديونية|مديونية)$/i.test(
    t
  );
}

function startDebtPurchaseFlow(options = {}) {
  // الكوبري يسأل القطاع مباشرة (ما نعتمد على Auto Reply في Interakt)
  const askSector = options.askSector !== false;
  const sectorBody = "اختر";
  return {
    ok: true,
    flow: "debt_chat",
    reply: askSector ? sectorBody : null,
    interactive: askSector
      ? {
          kind: "buttons",
          body: sectorBody,
          buttons: [
            { id: "civilian", title: "مدني" },
            { id: "retired", title: "متقاعد" },
            { id: "military", title: "عسكري" },
          ],
        }
      : null,
    draft: {
      flow: "debt_chat",
      step: "sector",
    },
  };
}

function debtRulesText() {
  return (
    CONFIG.messages?.debtPurchaseRules ||
    `تنويه بخصوص شراء المديونية:

نشتري مديونية الشركات فقط مثل: إمكان، النايفات، اليسر
ونشتري مديونية واحدة فقط`
  );
}

function debtCommitmentsPrompt() {
  return (
    CONFIG.messages?.commitmentsDebtPurchase ||
    `أرسل إجمالي الالتزامات الشهرية بالأرقام فقط
(جميع الأقساط عندك بدون قسط الشركة التي نشتري مديونيتها).

مثال:
3500`
  );
}

function debtAmountPrompt() {
  return (
    CONFIG.messages?.debtPurchaseAmount ||
    `كم مبلغ شراء المديونية المطلوب؟

أرسل المبلغ بالأرقام فقط.

مثال:
20000`
  );
}

function advanceDebtPurchaseFlow(draft, text) {
  const state = { ...(draft || {}), flow: "debt_chat" };
  const step = state.step || "sector";
  const raw = String(text || "").trim();

  if (looksLikeStartDebtPurchase(raw)) {
    return startDebtPurchaseFlow();
  }

  if (step === "sector") {
    const jobCategory = mapSector(raw);
    if (!jobCategory) {
      return {
        ok: false,
        reply: `ما قدرت أحدد القطاع.
أرسل:
1- مدني
2- متقاعد
3- عسكري`,
        draft: state,
      };
    }
    // للمدني: حكومي/خاص أولًا — تنويه المديونية يطلع مع سؤال الراتب
    if (jobCategory === "civilian") {
      return afterSectorSelected(state, jobCategory);
    }
    return afterSectorSelected(
      state,
      jobCategory,
      `${debtRulesText()}

${salaryPrompt(jobCategory)}`
    );
  }

  const civilianSalaryMsg = `${debtRulesText()}

${salaryPrompt("civilian")}`;
  const civilianStep = advanceCivilianSubtypeFlow(
    state,
    raw,
    civilianSalaryMsg
  );
  if (civilianStep) return civilianStep;

  if (step === "salary") {
    const salary = parseSalaryReply(raw);
    if (!Number.isFinite(salary) || salary <= 0) {
      return {
        ok: false,
        reply: invalidSalaryPrompt(state.jobCategory),
        draft: state,
      };
    }
    // مدني/متقاعد من 4000 — عسكري من 10000
    if (!meetsMinimumSalary(salary, state.jobCategory)) {
      return {
        ok: false,
        reply: lowSalaryApology(state.jobCategory),
        draft: null,
        clearDraft: true,
      };
    }
    state.salary = salary;
    state.step = "real_estate";
    return realEstateStepReply(state);
  }

  if (step === "real_estate") {
    const realEstateType = parseRealEstateChoice(raw);
    if (!realEstateType) {
      return {
        ok: false,
        reply: `ما قدرت أحدد حالة العقاري.
اختر من القائمة أو أرسل:
1- لا يوجد عقاري
2- عقاري مدعوم
3- عقاري غير مدعوم
4- عقاري قديم الي قسطه 1667`,
        interactive: realEstateInteractive(),
        draft: state,
      };
    }
    state.realEstateType = realEstateType;

    if (realEstateType === "supported") {
      state.step = "support";
      return {
        ok: true,
        reply: `كم قيمة الدعم العقاري الشهري؟
أرسل الرقم فقط
مثال: 1000
إذا ما فيه دعم أرسل: 0`,
        draft: state,
      };
    }

    state.supportAmount = 0;
    state.step = "commitments";
    return {
      ok: true,
      reply: debtCommitmentsPrompt(),
      draft: state,
    };
  }

  if (step === "support") {
    const supportAmount = parseSalaryReply(raw);
    if (!Number.isFinite(supportAmount) || supportAmount < 0) {
      return {
        ok: false,
        reply: `أرسل مبلغ الدعم بالأرقام فقط.
مثال: 1000`,
        draft: state,
      };
    }
    state.supportAmount = supportAmount;
    state.step = "commitments";
    return {
      ok: true,
      reply: debtCommitmentsPrompt(),
      draft: state,
    };
  }

  if (step === "commitments") {
    const commitments = parseSalaryReply(raw);
    if (!Number.isFinite(commitments) || commitments < 0) {
      return {
        ok: false,
        reply:
          CONFIG.messages?.invalidCommitmentsDebtPurchase ||
          `الرجاء كتابة إجمالي الالتزامات بالأرقام فقط
(جميع الأقساط عندك بدون قسط الشركة التي نشتري مديونيتها).

مثال:
3500`,
        draft: state,
      };
    }
    state.commitments = commitments;
    state.step = "debt_amount";
    return {
      ok: true,
      reply: debtAmountPrompt(),
      draft: state,
    };
  }

  if (step === "debt_amount") {
    const debtAmount = parseSalaryReply(raw);
    if (!Number.isFinite(debtAmount) || debtAmount <= 0) {
      return {
        ok: false,
        reply:
          CONFIG.messages?.invalidDebtPurchaseAmount ||
          `الرجاء كتابة مبلغ شراء المديونية بالأرقام فقط.

مثال:
20000`,
        draft: state,
      };
    }
    state.debtAmount = debtAmount;
    const offer = calculateDebtPurchaseOffer({
      debtAmount,
      jobCategory: state.jobCategory,
      salary: state.salary,
      commitments: state.commitments,
      realEstateType: state.realEstateType || "none",
      supportAmount: state.supportAmount || 0,
    });
    if (!offer.ok) {
      return {
        ...offer,
        draft: null,
        clearDraft: true,
      };
    }
    return {
      ...offer,
      draft: {
        ...state,
        step: "debt_continue",
        awaitingDebtContinue: true,
        ...offer.data,
      },
      sessionData: offer.data,
    };
  }

  if (step === "debt_continue") {
    const choice = looksLikeDebtContinueReply(raw);
    if (!choice) {
      const retryQ =
        CONFIG.messages?.debtContinueQuestion ||
        `هل تبي تكمل إجراءات شراء المديونية؟`;
      return {
        ok: false,
        reply: retryQ,
        interactive: {
          kind: "buttons",
          body: retryQ,
          buttons: [
            { id: "debt_yes", title: "نعم" },
            { id: "debt_no", title: "لا" },
          ],
        },
        draft: state,
      };
    }
    if (choice === "yes") {
      return {
        ...buildDebtPurchaseComplete(),
        draft: null,
        clearDraft: true,
      };
    }
    return {
      ...buildDebtPurchaseDeclined(),
      draft: null,
      clearDraft: true,
    };
  }

  return startDebtPurchaseFlow();
}

module.exports = {
  looksLikeStartDebtPurchase,
  startDebtPurchaseFlow,
  advanceDebtPurchaseFlow,
};
