const {
  calculatePersonalFinance,
  parsePersonalFinanceMessage,
  calculateSelectedAmount,
  parseAmountChoice,
  selectTiersForWhatsAppList,
  applyLowerAmountTerm,
  getAvailableYearsForAmount,
} = require("../lib/personal-finance");
const { buildLowerAmountTiers } = require("../lib/calculations");

const sample = `الراتب: 8000
الالتزامات: 1500
القطاع: مدني
العقاري: لا يوجد
الدعم: 0`;

const parsed = parsePersonalFinanceMessage(sample);
const result = calculatePersonalFinance(parsed);
console.log("--- الحسبة الأولى (أعلى مبلغ + قائمة أقل) ---");
console.log(result.reply);
console.log("\n--- رسالة التقديم المنفصلة ---");
console.log(result.followUpReply);
console.log("\ninteractive:", JSON.stringify(result.interactive, null, 2));

if (String(result.reply).includes("سجل مبلغ التمويل المرغوب فيه")) {
  console.error("FAIL: رسالة التقديم لازم تكون منفصلة عن نتيجة الحساب");
  process.exitCode = 1;
}

if (
  !result.followUpReply ||
  !String(result.followUpReply).includes("سجل مبلغ التمويل المرغوب فيه") ||
  !String(result.followUpReply).includes("SF1695") ||
  !String(result.followUpReply).includes("وارسلي رقم الطلب")
) {
  console.error("FAIL: لازم followUpReply برمز الموظف SF1695");
  process.exitCode = 1;
}

if (!result.sendTextThenInteractive) {
  console.error("FAIL: لازم sendTextThenInteractive");
  process.exitCode = 1;
}

if (
  !result.interactive ||
  result.interactive.kind !== "list" ||
  result.interactive.body !== "اختر مبلغ أقل هنا"
) {
  console.error("FAIL: لازم قائمة اختر مبلغ أقل هنا أولًا", result.interactive);
  process.exitCode = 1;
} else {
  const first = result.interactive.rows[0];
  const last = result.interactive.rows[result.interactive.rows.length - 1];
  const max = result.data.maxAmount;
  if (first?.id === `amt_${max}`) {
    console.error("FAIL: أعلى مبلغ ما يكون داخل قائمة الأقل");
    process.exitCode = 1;
  } else if (last?.id !== "amt_10000") {
    console.error("FAIL: آخر خيار لازم 10,000", last);
    process.exitCode = 1;
  } else {
    console.log("OK: أول نتيجة تعرض قائمة أقل تنتهي بـ 10,000");
  }
}

const amountSession = result.data;

// محاكاة مبلغ عالي مثل الشاشة (حوالي 126 ألف) — خطوة 5,000
const highTiers = buildLowerAmountTiers(126000, 5000, 10000);
const picked = selectTiersForWhatsAppList(highTiers, 10);
if (picked[picked.length - 1] !== 10000) {
  console.error("FAIL: العيّنة ما توصل 10,000", picked);
  process.exitCode = 1;
} else {
  console.log("OK: عيّنة المبالغ العالية تصل لـ 10,000:", picked.join(", "));
}

// أعلى 60,000 → مبالغ أقل بخطوة 5,000 حتى 10,000
const from60 = buildLowerAmountTiers(60000, 5000, 10000);
if (
  from60[0] !== 55000 ||
  !from60.includes(50000) ||
  !from60.includes(45000) ||
  from60[from60.length - 1] !== 10000
) {
  console.error("FAIL: قائمة 60,000 بخطوة 5,000", from60);
  process.exitCode = 1;
} else {
  console.log("OK: من 60,000 →", from60.join(", "));
}

if (amountSession?.lowerTiers?.length) {
  const pick = amountSession.lowerTiers[amountSession.lowerTiers.length - 1]; // 10,000
  const selected = calculateSelectedAmount(amountSession, pick);
  console.log(`\n--- بعد اختيار ${pick} ---`);
  console.log(selected.reply);
  const years = getAvailableYearsForAmount(amountSession, pick);
  if (!selected.ok) {
    console.error("FAIL: اختيار المبلغ", selected.reply);
    process.exitCode = 1;
  } else if (years.length > 1) {
    if (
      !selected.data?.awaitingLowerAmountTerm ||
      selected.data.pendingSelectedAmount !== pick
    ) {
      console.error("FAIL: لازم سؤال السنوات بعد المبلغ", selected.data);
      process.exitCode = 1;
    } else {
      console.log("OK: بعد المبلغ نسأل السنوات المتاحة:", years.join(", "));
      const finalized = applyLowerAmountTerm(selected.data, years[0]);
      console.log("\n--- بعد اختيار السنوات ---");
      console.log(finalized.reply);
      console.log("\n--- follow-up بعد الاختيار ---");
      console.log(finalized.followUpReply);
      if (
        !finalized.followUpReply ||
        !String(finalized.followUpReply).includes("SF1695")
      ) {
        console.error("FAIL: اختيار المدة لازم followUpReply برمز SF1695");
        process.exitCode = 1;
      }
    }
  } else if (
    !selected.followUpReply ||
    !String(selected.followUpReply).includes("SF1695")
  ) {
    console.error("FAIL: اختيار المبلغ (مدة واحدة) لازم followUpReply برمز SF1695");
    process.exitCode = 1;
  }
}

const fromListId = parseAmountChoice(`amt_${amountSession.lowerTiers[0]}`);
if (fromListId !== amountSession.lowerTiers[0]) {
  console.error("FAIL: parseAmountChoice من amt_");
  process.exitCode = 1;
}

const fromTitle = parseAmountChoice("15,000 ريال");
const fromTitleDesc = parseAmountChoice("15,000 ريال مبلغ أقل");
const fromTitleDescNl = parseAmountChoice("15,000 ريال\nمبلغ أقل");
const fromTen = parseAmountChoice("مبلغ أقل 10,000 ريال");
if (
  fromTitle !== 15000 ||
  fromTitleDesc !== 15000 ||
  fromTitleDescNl !== 15000 ||
  fromTen !== 10000
) {
  console.error("FAIL: parseAmountChoice من عنوان قائمة واتساب", {
    fromTitle,
    fromTitleDesc,
    fromTitleDescNl,
    fromTen,
  });
  process.exitCode = 1;
} else {
  console.log("OK: اختيار «15,000 ريال مبلغ أقل» من قائمة المبالغ");
}

// تغيير الرأي: بعد مسار 15,000 يختار 10,000
const firstPick = calculateSelectedAmount(amountSession, 15000);
let sessionAfterFirst = { ...amountSession, ...firstPick.data };
if (firstPick.data?.awaitingLowerAmountTerm) {
  const y = firstPick.data.availableYearsForAmount[0];
  const done = applyLowerAmountTerm(firstPick.data, y);
  sessionAfterFirst = { ...amountSession, ...done.data };
}
const secondPick = calculateSelectedAmount(sessionAfterFirst, 10000);
if (!firstPick.ok || !secondPick.ok) {
  console.error("FAIL: تغيير الرأي لمبلغ أقل 10,000", {
    firstOk: firstPick.ok,
    secondOk: secondPick.ok,
    reply: secondPick.reply,
  });
  process.exitCode = 1;
} else if (secondPick.data?.awaitingLowerAmountTerm) {
  console.log("OK: تغيير الرأي إلى 10,000 ثم سؤال السنوات");
} else if (
  secondPick.data?.selectedAmount === 10000 &&
  String(secondPick.reply).includes("10,000")
) {
  console.log("OK: تغيير الرأي من مبلغ إلى 10,000");
} else {
  console.error("FAIL: تغيير الرأي لمبلغ أقل 10,000", secondPick);
  process.exitCode = 1;
}

// رجوع: القسط ما يتجاوز المتاح — عسكري / مدني / متقاعد
const capacityCases = [
  {
    name: "عسكري",
    input: {
      jobCategory: "military",
      realEstateType: "supported",
      salary: 11000,
      commitments: 5000,
      supportAmount: 1070,
    },
  },
  {
    name: "مدني",
    input: {
      jobCategory: "civilian",
      realEstateType: "none",
      salary: 8000,
      commitments: 1500,
      supportAmount: 0,
    },
  },
  {
    name: "متقاعد",
    input: {
      jobCategory: "retired",
      realEstateType: "unsupported",
      salary: 9000,
      commitments: 2000,
      supportAmount: 0,
    },
  },
];

for (const c of capacityCases) {
  const got = calculatePersonalFinance(c.input);
  if (!got.ok) {
    console.error(`FAIL: حسبة ${c.name} المفروض تنجح`, got.reply);
    process.exitCode = 1;
    continue;
  }
  if (got.data.installment > got.data.monthlyCapacity) {
    console.error(
      `FAIL: قسط ${c.name} تجاوز المتاح`,
      got.data.installment,
      ">",
      got.data.monthlyCapacity
    );
    process.exitCode = 1;
  } else {
    console.log(
      `OK: قسط ${c.name} ضمن المتاح`,
      got.data.installment,
      "<=",
      got.data.monthlyCapacity,
      "| مبلغ",
      got.data.maxAmount,
      "| فائدة",
      got.data.rate
    );
  }
}
