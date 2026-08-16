/**
 * أمثلة مبالغ التمويل (بدون حسبة) — للقائمة الرئيسية
 * بعد القطاع: 10,000 / 15,000 / 20,000 ثم «اختر مبالغ أعلى» لبقية المبالغ
 */
const CONFIG = require("../config");
const {
  calculateMonthlyInstallment,
  formatMoney,
} = require("./calculations");

const QUICK_AMOUNTS = [10000, 15000, 20000];
const MORE_ID = "ex_more";
const HIGHER_PAGE_SIZE = 9; // + صف «مبالغ أعلى» = 10 كحد واتساب

function amountExamplesConfig() {
  const cfg = CONFIG.amountExamples || {};
  return {
    min: Number(cfg.min || 10000),
    max: Number(cfg.max || 150000),
    step: Number(cfg.step || 5000),
  };
}

function amountExamplesLabel(jobCategory) {
  if (jobCategory === "military") return "عسكري";
  if (jobCategory === "retired") return "متقاعد";
  if (jobCategory === "private") return "قطاع خاص";
  if (jobCategory === "civilian") return "قطاع حكومي";
  return CONFIG.jobCategories?.[jobCategory]?.label || "مدني";
}

function rateForCategory(jobCategory) {
  return (
    CONFIG.jobCategories?.[jobCategory]?.interestRate ||
    (jobCategory === "military"
      ? 18.5
      : jobCategory === "private"
        ? 15.5
        : 13)
  );
}

function rateLabel(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function installmentFor(amount, jobCategory) {
  const rate = rateForCategory(jobCategory);
  return calculateMonthlyInstallment(
    amount,
    rate,
    CONFIG.financing?.loanTermMonths || 60,
    jobCategory
  );
}

/** كل المبالغ من 25,000 إلى الحد الأعلى بخطوة الإعداد */
function higherAmountsList() {
  const { max, step } = amountExamplesConfig();
  const start = 25000;
  const out = [];
  for (let amount = start; amount <= max; amount += step) {
    out.push(amount);
  }
  // لو الخطوة ما تمرّ على max بالضبط، أضف الحد الأعلى
  if (out.length && out[out.length - 1] !== max && max > start) {
    out.push(max);
  }
  return out;
}

function amountRow(amount, jobCategory) {
  const installment = installmentFor(amount, jobCategory);
  const title = `${formatMoney(amount)} ريال`;
  return {
    id: `ex_${amount}`,
    title: title.length <= 24 ? title : `${formatMoney(amount)}`,
    description: `القسط: ${formatMoney(installment)} ريال`,
  };
}

/** الشاشة الأولى: 10k / 15k / 20k + اختر مبالغ أعلى (قائمة — حد واتساب 3 أزرار رد) */
function buildQuickAmountsInteractive(jobCategory) {
  const rows = QUICK_AMOUNTS.map((amount) => amountRow(amount, jobCategory));
  rows.push({
    id: MORE_ID,
    title: "اختر مبالغ أعلى",
    description: "من 25,000 فأعلى",
  });
  const label = amountExamplesLabel(jobCategory);
  const rate = rateForCategory(jobCategory);
  return {
    kind: "list",
    body: `أمثلة مبالغ التمويل — ${label}\nنسبة تقريبية ${rateLabel(rate)}% · 60 شهر`,
    button: "اختر المبلغ",
    sectionTitle: "المبالغ",
    rows,
  };
}

/** صفحات المبالغ الأعلى — 9 مبالغ + «مبالغ أعلى» إن وجد المزيد */
function buildHigherAmountsInteractive(jobCategory, page = 0) {
  const all = higherAmountsList();
  const start = page * HIGHER_PAGE_SIZE;
  const slice = all.slice(start, start + HIGHER_PAGE_SIZE);
  const hasMore = start + HIGHER_PAGE_SIZE < all.length;
  const rows = slice.map((amount) => amountRow(amount, jobCategory));
  if (hasMore) {
    rows.push({
      id: `${MORE_ID}_${page + 1}`,
      title: "مبالغ أعلى",
      description: "عرض المزيد",
    });
  }
  const label = amountExamplesLabel(jobCategory);
  return {
    kind: "list",
    body: `مبالغ أعلى — ${label}`,
    button: "اختر المبلغ",
    sectionTitle: "المبالغ",
    rows,
  };
}

function parseExampleAmount(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const id = t.match(/^ex_(\d+)$/i);
  if (id) {
    const amount = Number(id[1]);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }
  // عنوان واتساب مثل «10,000 ريال» أو مع وصف القسط
  const cleaned = t
    .replace(/\n+/g, " ")
    .replace(/\s*القسط\s*[:：]?\s*[\d,.]+\s*ريال?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = cleaned.match(
    /^[\s]*([0-9]{1,3}(?:[.,\s]?[0-9]{3})+|[0-9]+)[\s]*(?:ريال)?[\s]*$/i
  );
  if (!m) return null;
  const amount = Number(String(m[1]).replace(/[^\d]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function looksLikeMoreAmounts(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t === MORE_ID || /^ex_more(?:_\d+)?$/i.test(t)) return true;
  if (/^اختر\s*مبالغ\s*أعلى$/i.test(t)) return true;
  if (/^مبالغ\s*أعلى$/i.test(t)) return true;
  return false;
}

function morePageFromText(text) {
  const t = String(text || "").trim();
  const m = t.match(/^ex_more_(\d+)$/i);
  if (m) return Number(m[1]);
  if (t === MORE_ID || /^اختر\s*مبالغ\s*أعلى$/i.test(t)) return 0;
  if (/^مبالغ\s*أعلى$/i.test(t)) return null; // يكمل من المسودة
  return 0;
}

function amountExamplesCtaInteractive() {
  return {
    kind: "buttons",
    body: "تقدم بتمويلك الآن؟",
    buttons: [
      {
        id: "start_personal_from_examples",
        title: "تقدم بتمويلك الآن",
      },
    ],
  };
}

function looksLikeAmountExamplesCta(text) {
  const t = String(text || "")
    .trim()
    .replace(/[.\u061F؟?!]+$/g, "")
    .trim();
  if (!t || t.length > 60) return false;
  if (/^start_personal_from_examples$/i.test(t)) return true;
  if (/^تقدم\s*بتمويلك\s*الان$/i.test(t)) return true;
  if (/^تقدم\s*بتمويلك\s*الآن$/i.test(t)) return true;
  if (/^تقدم\s*بطلب\s*التمويل\s*الان$/i.test(t)) return true;
  if (/^تقدم\s*بطلب\s*التمويل\s*الآن$/i.test(t)) return true;
  if (/تقدم.*(تمويلك|التمويل|بطلب)/i.test(t) && t.length <= 40) return true;
  return false;
}

function askAmountExamplesSector() {
  return {
    ok: true,
    flow: "main_menu",
    reply: "اختر",
    interactive: {
      kind: "buttons",
      body: "اختر",
      buttons: [
        { id: "amt_civilian", title: "مدني" },
        { id: "amt_military", title: "عسكري" },
        { id: "amt_retired", title: "متقاعد" },
      ],
    },
    draft: {
      flow: "main_menu",
      step: "awaiting_amount_examples_sector",
    },
  };
}

function askAmountExamplesCivilianSubtype() {
  return {
    ok: true,
    flow: "main_menu",
    reply: "مدني — اختر: قطاع حكومي أو قطاع خاص",
    interactive: {
      kind: "buttons",
      body: "مدني — اختر: قطاع حكومي أو قطاع خاص",
      buttons: [
        { id: "amt_gov", title: "قطاع حكومي" },
        { id: "amt_private", title: "قطاع خاص" },
      ],
    },
    draft: {
      flow: "main_menu",
      step: "awaiting_amount_examples_civilian_subtype",
    },
  };
}

function parseAmountExamplesSector(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (/^(عسكري|military|amt_military|2)$/i.test(t) || t === "عسكري") {
    return "military";
  }
  if (/^(متقاعد|retired|amt_retired|3)$/i.test(t) || t === "متقاعد") {
    return "retired";
  }
  if (/^(مدني|civilian|amt_civilian|1)$/i.test(t) || t === "مدني") {
    return "civilian";
  }
  return null;
}

function parseAmountExamplesCivilianSubtype(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (
    /^(قطاع\s*حكومي|حكومي|government|gov|amt_gov|civilian_gov|1)$/i.test(t) ||
    t === "قطاع حكومي"
  ) {
    return "civilian";
  }
  if (
    /^(قطاع\s*خاص|خاص|private|amt_private|civilian_private|2)$/i.test(t) ||
    t === "قطاع خاص"
  ) {
    return "private";
  }
  return null;
}

function showAmountExamplesPicker(jobCategory) {
  const interactive = buildQuickAmountsInteractive(jobCategory);
  return {
    ok: true,
    flow: "main_menu",
    reply: interactive.body,
    interactive,
    draft: {
      flow: "main_menu",
      step: "awaiting_amount_examples_pick",
      amountExamplesSector: jobCategory,
      amountExamplesPage: 0,
    },
  };
}

function showHigherAmountsPage(jobCategory, page = 0) {
  const interactive = buildHigherAmountsInteractive(jobCategory, page);
  return {
    ok: true,
    flow: "main_menu",
    reply: interactive.body,
    interactive,
    draft: {
      flow: "main_menu",
      step: "awaiting_amount_examples_pick",
      amountExamplesSector: jobCategory,
      amountExamplesPage: page,
    },
  };
}

function showSelectedExampleAmount(jobCategory, amount) {
  const rate = rateForCategory(jobCategory);
  const installment = installmentFor(amount, jobCategory);
  const label = amountExamplesLabel(jobCategory);
  const reply = `مثال مبلغ التمويل — ${label}

قيمة التمويل:
${formatMoney(amount)} ريال

القسط الشهري التقريبي:
${formatMoney(installment)} ريال

(نسبة تقريبية ${rateLabel(rate)}% لمدة 60 شهر)

ملاحظة: مثال توضيحي فقط وليس عرضًا ملزمًا.`;

  return {
    ok: true,
    flow: "main_menu",
    reply,
    interactive: amountExamplesCtaInteractive(),
    sendTextThenInteractive: true,
    draft: {
      flow: "main_menu",
      step: "awaiting_amount_examples_cta",
      amountExamplesSector: jobCategory,
      amountExamplesSelected: amount,
    },
  };
}

function handleAmountExamplesSector(text) {
  const sector = parseAmountExamplesSector(text);
  if (!sector) {
    return {
      ok: false,
      ...askAmountExamplesSector(),
      reply: "اختر",
    };
  }
  if (sector === "civilian") {
    return askAmountExamplesCivilianSubtype();
  }
  return showAmountExamplesPicker(sector);
}

function handleAmountExamplesCivilianSubtype(text) {
  const jobCategory = parseAmountExamplesCivilianSubtype(text);
  if (!jobCategory) {
    return {
      ok: false,
      ...askAmountExamplesCivilianSubtype(),
      reply: "اختر: قطاع حكومي أو قطاع خاص",
    };
  }
  return showAmountExamplesPicker(jobCategory);
}

function handleAmountExamplesPick(draft, text) {
  const jobCategory = draft?.amountExamplesSector || "civilian";
  const raw = String(text || "").trim();

  if (looksLikeMoreAmounts(raw)) {
    let page = morePageFromText(raw);
    if (page == null) {
      page = Number(draft?.amountExamplesPage || 0) + 1;
    }
    return showHigherAmountsPage(jobCategory, page);
  }

  const amount = parseExampleAmount(raw);
  if (!amount) {
    const page = Number(draft?.amountExamplesPage || 0);
    const interactive =
      page > 0
        ? buildHigherAmountsInteractive(jobCategory, page)
        : buildQuickAmountsInteractive(jobCategory);
    return {
      ok: false,
      reply: "اختر مبلغًا من القائمة.",
      interactive,
      draft: {
        flow: "main_menu",
        step: "awaiting_amount_examples_pick",
        amountExamplesSector: jobCategory,
        amountExamplesPage: page,
      },
    };
  }

  return showSelectedExampleAmount(jobCategory, amount);
}

/** للتوافق مع الاختبارات القديمة — ملخص نصي */
function buildAmountList(jobCategory) {
  const rate = rateForCategory(jobCategory);
  const label = amountExamplesLabel(jobCategory);
  const lines = [...QUICK_AMOUNTS, ...higherAmountsList()].map((amount) => {
    const installment = installmentFor(amount, jobCategory);
    return `${formatMoney(amount)} ريال — القسط: ${formatMoney(installment)} ريال`;
  });
  return `أمثلة مبالغ التمويل — ${label}
(نسبة تقريبية ${rateLabel(rate)}% لمدة 60 شهر)

${lines.join("\n")}

ملاحظة: هذه أمثلة توضيحية فقط وليست عرضًا ملزمًا.`;
}

module.exports = {
  QUICK_AMOUNTS,
  MORE_ID,
  buildAmountList,
  buildQuickAmountsInteractive,
  buildHigherAmountsInteractive,
  higherAmountsList,
  askAmountExamplesSector,
  askAmountExamplesCivilianSubtype,
  parseAmountExamplesSector,
  parseAmountExamplesCivilianSubtype,
  parseExampleAmount,
  looksLikeMoreAmounts,
  handleAmountExamplesSector,
  handleAmountExamplesCivilianSubtype,
  handleAmountExamplesPick,
  showAmountExamplesPicker,
  showSelectedExampleAmount,
  amountExamplesCtaInteractive,
  looksLikeAmountExamplesCta,
  amountExamplesConfig,
};
