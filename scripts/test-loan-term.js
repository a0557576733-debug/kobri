const assert = require("assert");
const {
  calculatePersonalFinance,
  calculateSelectedAmount,
  confirmLowerAmountSuggestion,
  parseLoanTermChoice,
  loanTermChoiceInteractive,
  getAvailableYearsForAmount,
  looksLikeWantLowerAmount,
  beginLowerAmountFlow,
  applyLowerAmountTerm,
} = require("../lib/personal-finance");
const { advancePersonalFinanceFlow } = require("../lib/conversation");

assert.strictEqual(parseLoanTermChoice("3 سنوات"), 3);
assert.strictEqual(parseLoanTermChoice("term_5"), 5);
assert.strictEqual(parseLoanTermChoice("سنتين"), 2);
assert.strictEqual(parseLoanTermChoice("سنة"), 1);
assert.ok(looksLikeWantLowerAmount("want_lower_amount"));
assert.ok(looksLikeWantLowerAmount("مبلغ أقل"));
assert.ok(looksLikeWantLowerAmount("اختر مبلغ أقل هنا"));

const fiveOpts = loanTermChoiceInteractive([5, 4, 3, 2, 1]);
assert.strictEqual(fiveOpts.kind, "list");
assert.ok(fiveOpts.rows.some((r) => r.id === "term_1"));

const twoOpts = loanTermChoiceInteractive([5, 4]);
assert.strictEqual(twoOpts.kind, "buttons");
assert.strictEqual(twoOpts.buttons.length, 2);

// بعد العقاري → حسبة على 5 سنوات + قائمة مبلغ أقل مباشرة
const afterRe = advancePersonalFinanceFlow(
  {
    flow: "personal_chat",
    step: "real_estate",
    jobCategory: "civilian",
    civilianSubtype: "government",
    salary: 8000,
    commitments: 1500,
  },
  "لا يوجد"
);
assert.ok(afterRe.ok);
assert.ok(!afterRe.draft || afterRe.draft === null);
assert.strictEqual(afterRe.sessionData?.loanTermMonths, 60);
assert.strictEqual(afterRe.sessionData?.awaitingAmountChoice, true);
assert.strictEqual(afterRe.interactive?.kind, "list");
assert.strictEqual(afterRe.interactive?.body, "اختر مبلغ أقل هنا");
assert.ok(String(afterRe.reply).includes("5 سنوات"));

// توافق: «مبلغ أقل» يعيد قائمة المبالغ
const lowerStart = beginLowerAmountFlow(afterRe.sessionData);
assert.strictEqual(lowerStart.interactive?.kind, "list");
assert.strictEqual(lowerStart.data.awaitingAmountChoice, true);

// اختيار مبلغ → سنوات متاحة فقط (أكثر من واحدة → سؤال)
const pick = afterRe.sessionData.lowerTiers[0];
const afterAmount = calculateSelectedAmount(afterRe.sessionData, pick);
assert.ok(afterAmount.ok, afterAmount.reply);
const available = getAvailableYearsForAmount(afterRe.sessionData, pick);
assert.ok(available.length >= 1);
if (available.length === 1) {
  assert.strictEqual(afterAmount.data.selectedAmount, pick);
  assert.strictEqual(afterAmount.data.loanTermYears, available[0]);
  assert.ok(afterAmount.followUpReply);
} else {
  assert.strictEqual(afterAmount.data.awaitingLowerAmountTerm, true);
  assert.strictEqual(afterAmount.data.pendingSelectedAmount, pick);
  assert.deepStrictEqual(afterAmount.data.availableYearsForAmount, available);
  assert.ok(!afterAmount.followUpReply);

  const yearsPick = available[available.length - 1]; // أقصر مدة متاحة
  const finalized = applyLowerAmountTerm(afterAmount.data, yearsPick);
  assert.ok(finalized.ok, finalized.reply);
  assert.strictEqual(finalized.data.selectedAmount, pick);
  assert.strictEqual(finalized.data.loanTermYears, yearsPick);
  assert.ok(finalized.followUpReply);
  assert.ok(String(finalized.reply).includes(yearsPick === 1 ? "سنة" : String(yearsPick)));
}

// مبلغ قريب من الأعلى → غالبًا 5 سنوات فقط → تثبيت تلقائي
const nearMax = afterRe.sessionData.maxAmount;
const onlyLong = calculateSelectedAmount(afterRe.sessionData, nearMax);
const yearsForMax = getAvailableYearsForAmount(afterRe.sessionData, nearMax);
assert.ok(yearsForMax.includes(5));
if (yearsForMax.length === 1) {
  assert.strictEqual(onlyLong.data.selectedAmount, nearMax);
  assert.strictEqual(onlyLong.data.loanTermYears, 5);
  assert.ok(!onlyLong.data.awaitingLowerAmountTerm);
} else {
  assert.strictEqual(onlyLong.data.awaitingLowerAmountTerm, true);
}

// مبلغ صغير جدًا → عدة سنوات بما فيها سنتين/سنة إن سمحت
const smallPick = 10000;
const yearsSmall = getAvailableYearsForAmount(afterRe.sessionData, smallPick);
assert.ok(yearsSmall.includes(5));
assert.ok(yearsSmall.length >= 2, `expected multiple years for 10k, got ${yearsSmall}`);

// بعد اختيار المدة: طلب مبلغ أعلى من المتاح → اقتراح أقل
const base = calculatePersonalFinance({
  jobCategory: "civilian",
  civilianSubtype: "government",
  salary: 10000,
  commitments: 1500,
  realEstateType: "none",
  loanTermYears: 5,
});
assert.ok(base.ok, base.reply);
const tooHigh = (base.data.maxAmount || 0) + 10000;
const suggestion = calculateSelectedAmount(base.data, tooHigh);
assert.ok(
  suggestion.offer === "lower_amount_suggestion" || !suggestion.ok,
  suggestion.reply
);
if (suggestion.offer === "lower_amount_suggestion") {
  assert.ok(String(suggestion.reply).includes("ما يسمح فيه وضع التزاماتك"));
  const confirmed = confirmLowerAmountSuggestion(suggestion.data, "yes");
  assert.ok(confirmed.ok);
  assert.ok(
    confirmed.data.selectedAmount === suggestion.data.suggestedAmount ||
      confirmed.data.pendingSelectedAmount === suggestion.data.suggestedAmount
  );
}

console.log("OK: amount first, then available years only");
