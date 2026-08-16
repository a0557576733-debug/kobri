/**
 * محادثة تمويل شخصي خطوة بخطوة (مثل البوت القديم)
 */
const {
  mapSector,
  mapRealEstate,
  calculatePersonalFinance,
  buildPropertyComboInterestAsk,
} = require("./personal-finance");
const {
  getMinSalaryForEntry,
  getMinSalaryForCategory,
  meetsMinimumSalaryForEntry,
} = require("./calculations");
const { normalizeDigits } = require("./digits");
const CONFIG = require("../config");

function loanTermFallbackYearsSafe() {
  return Number(CONFIG.financing?.loanTermFallbackYears) || 5;
}
const {
  searchApprovedCompanies,
  companyListInteractive,
  parseCompanyPick,
  listTitleForCompany,
  looksLikeCompanyResearch,
  parseCivilianSubtype,
  civilianSubtypeButtons,
} = require("./approved-companies");

function looksLikeStartPersonalFinance(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.length > 60) return false;
  // ملاحظة: لا نستخدم الرقم "1" هنا لأنه خيار في أسئلة العقاري/الباقة
  return /^(تمويل شخصي|ابي تمويل شخصي|أبي تمويل شخصي|ابي تمويل|أبي تمويل|تمويل|ابدأ|ابدا|ابدأ الحسبة|ابدا الحسبة)$/i.test(
    t
  );
}

function startPersonalFinanceFlow(options = {}) {
  // افتراضيًا صامت: Interakt يعرض أزرار القطاع (مدني/متقاعد/عسكري)
  // حتى لا تتكرر الرسالة مرتين
  const askSector = options.askSector === true;
  const sectorBody = "اختر";
  return {
    ok: true,
    flow: "personal_chat",
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
      flow: "personal_chat",
      step: "sector",
    },
  };
}

function parseSalaryReply(text) {
  const t = normalizeDigits(text).trim();
  const m = t.match(/([0-9][0-9,]*)/);
  if (!m) return NaN;
  return Number(String(m[1]).replace(/,/g, ""));
}

/** مثال الراتب حسب القطاع */
function salaryExampleForSector(jobCategory) {
  if (jobCategory === "military") return "10000";
  // مدني حكومي + قطاع خاص + متقاعد
  return "4000";
}

function restartHint() {
  return `إذا حطيت رقم خطأ اكتب: إعادة`;
}

function salaryPrompt(jobCategory) {
  const example = salaryExampleForSector(jobCategory);
  return `كم راتبك الشهري؟
أرسل الرقم فقط
مثال: ${example} ريال

${restartHint()}`;
}

function invalidSalaryPrompt(jobCategory) {
  const example = salaryExampleForSector(jobCategory);
  return `أرسل الراتب بالأرقام فقط.
مثال: ${example} ريال

${restartHint()}`;
}

function commitmentsPrompt() {
  return `كم إجمالي التزاماتك الشهرية؟
أرسل الرقم فقط
مثال: 1500
إذا ما عليك التزامات أرسل: 0

${restartHint()}`;
}

function lowSalaryApology(jobCategory) {
  const min = getMinSalaryForEntry(jobCategory);
  const formatted = Number(min).toLocaleString("en-US");
  if (jobCategory === "military") {
    return `نعتذر منك الراتب أقل من المطلوب.
الراتب المطلوب للعسكري من ${formatted} ريال`;
  }
  if (jobCategory === "retired") {
    return `نعتذر منك الراتب أقل من المطلوب.
راتب المتقاعد من ${formatted} ريال`;
  }
  if (jobCategory === "private") {
    return `نعتذر منك الراتب أقل من المطلوب.
راتب القطاع الخاص من ${formatted} ريال`;
  }
  return `نعتذر منك الراتب أقل من المطلوب.
راتب المدني من ${formatted} ريال`;
}

function realEstatePrompt() {
  return `هل عليك تمويل عقاري اختر النوع من القائمة`;
}

/** قائمة تفاعلية (Interakt InteractiveList) — أفضل من أزرار لأن الخيارات 4 */
function realEstateInteractive() {
  return {
    kind: "list",
    body: "هل عليك تمويل عقاري اختر النوع من القائمة",
    button: "اختر النوع",
    sectionTitle: "التمويل العقاري",
    rows: [
      {
        id: "re_none",
        title: "لا يوجد عقاري",
        description: "ما علي تمويل عقاري",
      },
      {
        id: "re_supported",
        title: "عقاري مدعوم",
        description: "تمويل عقاري مدعوم",
      },
      {
        id: "re_unsupported",
        title: "عقاري غير مدعوم",
        description: "تمويل عقاري غير مدعوم",
      },
      {
        id: "re_old",
        title: "عقاري قديم",
        description: "الي قسطه 1667 ريال",
      },
    ],
  };
}

function realEstateStepReply(state) {
  return {
    ok: true,
    // نص احتياطي فقط إذا فشلت القائمة التفاعلية
    reply: realEstatePrompt(),
    interactive: realEstateInteractive(),
    draft: state,
  };
}

function parseRealEstateChoice(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (/^(re_none|none)$/i.test(t) || /^1$/.test(t)) return "none";
  if (/^(re_supported|supported)$/i.test(t) || /^2$/.test(t)) return "supported";
  if (/^(re_unsupported|unsupported)$/i.test(t) || /^3$/.test(t)) {
    return "unsupported";
  }
  if (/^(re_old|old)$/i.test(t) || /^4$/.test(t)) return "old";
  return mapRealEstate(t);
}

function comboYesNoInteractive(bodyText) {
  return {
    kind: "buttons",
    body: bodyText,
    buttons: [
      { id: "combo_yes", title: "نعم" },
      { id: "combo_no", title: "لا" },
    ],
  };
}

/** عسكري راتبه تحت 10,000 + لا عقاري → سؤال حلول أخرى ثم الباقة */
function offerMilitaryPropertyCombo(state) {
  const result = buildPropertyComboInterestAsk({
    jobCategory: "military",
    salary: state.salary,
    commitments: state.commitments || 0,
    realEstateType: "none",
    supportAmount: 0,
    reason: "military_low_salary",
  });
  return {
    ...result,
    draft: {
      flow: state.flow || "personal_chat",
      step: "done",
      awaitingComboInterest: true,
      awaitingCombo: false,
      ...result.data,
    },
    sessionData: result.data,
  };
}

function militaryWithPropertyReject() {
  const min = getMinSalaryForCategory("military");
  const formatted = Number(min).toLocaleString("en-US");
  return `نعتذر منك الراتب أقل من المطلوب.
الراتب المطلوب للعسكري من ${formatted} ريال`;
}

/**
 * بعد اختيار «مدني»: حكومي / قطاع خاص + بحث الشركة المعتمدة
 * salaryMessage: نص سؤال الراتب (قد يشمل تنويه شراء المديونية)
 */
function advanceCivilianSubtypeFlow(state, raw, salaryMessage) {
  const step = state.step;

  if (step === "civilian_subtype") {
    const subtype = parseCivilianSubtype(raw);
    if (!subtype) {
      const interactive = civilianSubtypeButtons();
      return {
        ok: false,
        reply: `اختر نوع الجهة:
1- حكومي
2- قطاع خاص`,
        interactive,
        draft: state,
      };
    }
    state.civilianSubtype = subtype;
    if (subtype === "private") {
      state.jobCategory = "private";
      state.step = "company_name";
      state.companyMatches = [];
      return {
        ok: true,
        reply: `اكتب اسم شركتك (أو جزء منه).
بنعرض لك أقرب الشركات المعتمدة تختار منها.

مثال: الراجحي أو أرامكو أو البنك الأهلي`,
        draft: state,
      };
    }
    state.jobCategory = "civilian";
    state.step = "salary";
    return {
      ok: true,
      reply: salaryMessage || salaryPrompt("civilian"),
      draft: state,
    };
  }

  if (step === "company_name") {
    const matches = searchApprovedCompanies(raw, { limit: 9 });
    if (!matches.length) {
      return {
        ok: false,
        reply: `ما لقينا شركة مطابقة ضمن المعتمدة.
أعد كتابة الاسم بشكل أوضح، أو جزء أشهر من اسم الشركة.

إذا شركتك مو بالقائمة نعتذر منك — التمويل للقطاع الخاص يكون للشركات المعتمدة فقط.`,
        draft: state,
      };
    }
    state.companyMatches = matches.map((c) => ({
      name: c.name,
      nameEn: c.nameEn,
      index: c.index,
      listTitle: listTitleForCompany(c.name),
    }));
    state.step = "company_pick";
    const body =
      matches.length === 1
        ? "لقينا شركة واحدة — اخترها من القائمة، أو أعد البحث:"
        : `لقينا ${matches.length} نتائج — اختر شركتك، أو أعد البحث عن جهة عملك:`;
    return {
      ok: true,
      reply: body,
      interactive: companyListInteractive(matches, body),
      draft: state,
    };
  }

  if (step === "company_pick") {
    if (looksLikeCompanyResearch(raw)) {
      state.step = "company_name";
      state.companyMatches = [];
      return {
        ok: true,
        reply: `تمام — اكتب اسم جهة عملك من جديد (أو جزء منه).`,
        draft: state,
      };
    }

    const matches = state.companyMatches || [];
    const picked = parseCompanyPick(raw, matches);
    if (picked) {
      state.companyName = picked.name;
      state.companyApproved = true;
      state.jobCategory = "private";
      state.companyMatches = undefined;
      state.step = "salary";
      return {
        ok: true,
        reply: `تم اختيار: ${picked.name}

${salaryMessage || salaryPrompt("private")}`,
        draft: state,
      };
    }

    // بحث جديد فقط إذا النص مو عنوان صف من القائمة (واتساب يرسل العنوان المقطوع)
    const looksLikeStoredListTitle = matches.some(
      (c) =>
        c.listTitle === raw ||
        listTitleForCompany(c.name) === raw ||
        (c.name &&
          c.name.startsWith(String(raw).replace(/\.{2,}$/g, "").trim()))
    );
    if (raw.length >= 2 && !/^co_/i.test(raw) && !looksLikeStoredListTitle) {
      state.step = "company_name";
      return advanceCivilianSubtypeFlow(state, raw, salaryMessage);
    }

    if (!matches.length) {
      state.step = "company_name";
      return {
        ok: false,
        reply: `اكتب اسم شركتك مرة ثانية للبحث.`,
        draft: state,
      };
    }
    return {
      ok: false,
      reply: `اختر شركتك من القائمة، أو «إعادة البحث عن جهة عملك».`,
      interactive: companyListInteractive(matches),
      draft: state,
    };
  }

  return null;
}

function afterSectorSelected(state, jobCategory, salaryMessage) {
  state.jobCategory = jobCategory;
  if (jobCategory === "civilian") {
    state.step = "civilian_subtype";
    const interactive = civilianSubtypeButtons();
    return {
      ok: true,
      reply: interactive.body,
      interactive,
      draft: state,
    };
  }
  state.step = "salary";
  return {
    ok: true,
    reply: salaryMessage || salaryPrompt(jobCategory),
    draft: state,
  };
}

function advancePersonalFinanceFlow(draft, text) {
  const state = { ...(draft || {}), flow: "personal_chat" };
  const step = state.step || "sector";
  const raw = String(text || "").trim();

  // إعادة بدء من داخل المحادثة (لا تفسّر "تمويل" كقطاع)
  if (looksLikeStartPersonalFinance(raw)) {
    return startPersonalFinanceFlow({ askSector: true });
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
    return afterSectorSelected(state, jobCategory, salaryPrompt(jobCategory));
  }

  const civilianSalaryPrompt =
    state.jobCategory === "private"
      ? salaryPrompt("private")
      : salaryPrompt("civilian");
  const civilianStep = advanceCivilianSubtypeFlow(
    state,
    raw,
    civilianSalaryPrompt
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
    // رفض فوري إذا الراتب تحت الحد (مدني/متقاعد 4000، عسكري دخول 7000)
    if (!meetsMinimumSalaryForEntry(salary, state.jobCategory)) {
      return {
        ok: false,
        reply: lowSalaryApology(state.jobCategory),
        draft: null,
        clearDraft: true,
      };
    }
    state.salary = salary;

    // عسكري أقل من 10,000 → اسأله عن العقاري مباشرة (بدون التزامات)
    const personalMin = getMinSalaryForCategory(state.jobCategory);
    if (state.jobCategory === "military" && salary < personalMin) {
      state.commitments = 0;
      state.militaryLowSalaryPath = true;
      state.step = "real_estate";
      return realEstateStepReply(state);
    }

    state.step = "commitments";
    return {
      ok: true,
      reply: commitmentsPrompt(),
      draft: state,
    };
  }

  if (step === "commitments") {
    const commitments = parseSalaryReply(raw);
    if (!Number.isFinite(commitments) || commitments < 0) {
      return {
        ok: false,
        reply: `أرسل الالتزامات بالأرقام فقط.
مثال: 1500

${restartHint()}`,
        draft: state,
      };
    }
    state.commitments = commitments;
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

    // مسار العسكري تحت 10,000
    if (state.militaryLowSalaryPath) {
      if (realEstateType === "none") {
        return offerMilitaryPropertyCombo(state);
      }
      return {
        ok: false,
        reply: militaryWithPropertyReject(),
        draft: null,
        clearDraft: true,
      };
    }

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
    return finishPersonalFlow(state);
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
    return finishPersonalFlow(state);
  }

  // خطوة غير معروفة → نعيد من القطاع
  return startPersonalFinanceFlow();
}

function finishPersonalFlow(state) {
  // الحسبة الأولى دائمًا على المدة الافتراضية (5 سنوات)
  // اختيار السنوات يتأجل حتى يطلب العميل «مبلغ أقل»
  const result = calculatePersonalFinance({
    jobCategory: state.jobCategory,
    civilianSubtype: state.civilianSubtype,
    salary: state.salary,
    commitments: state.commitments,
    realEstateType: state.realEstateType || "none",
    supportAmount: state.supportAmount || 0,
    companyName: state.companyName,
    loanTermYears: loanTermFallbackYearsSafe(),
    loanTermMonths: loanTermFallbackYearsSafe() * 12,
  });

  const awaitingInterest = Boolean(result.data?.awaitingComboInterest);
  const awaitingCombo = Boolean(result.data?.awaitingCombo);
  const keepDraft = awaitingInterest || awaitingCombo;
  return {
    ...result,
    // إن ما فيه interactive جاهز (باقة قديمة) نضيف أزرار نعم/لا
    interactive:
      result.interactive ||
      (awaitingCombo
        ? comboYesNoInteractive(result.followUpReply || result.reply)
        : undefined),
    sendTextThenInteractive: Boolean(
      result.sendTextThenInteractive ||
        (result.reply && (result.interactive || awaitingCombo))
    ),
    draft: keepDraft
      ? {
          flow: "personal_chat",
          step: "done",
          ...result.data,
        }
      : null,
    sessionData: result.ok ? result.data : null,
  };
}

module.exports = {
  looksLikeStartPersonalFinance,
  startPersonalFinanceFlow,
  advancePersonalFinanceFlow,
  advanceCivilianSubtypeFlow,
  afterSectorSelected,
  realEstateInteractive,
  parseRealEstateChoice,
  parseSalaryReply,
  salaryPrompt,
  invalidSalaryPrompt,
  lowSalaryApology,
  realEstateStepReply,
  offerMilitaryPropertyCombo,
  militaryWithPropertyReject,
};
