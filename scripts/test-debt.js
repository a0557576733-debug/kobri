const assert = require("assert");
const {
  calculateDebtPurchaseOffer,
  calculateMonthlyCapacity,
  calculateMaxAmountFromMonthlyCapacity,
  looksLikeDebtContinueReply,
} = require("../lib/debt-purchase");
const {
  looksLikeStartDebtPurchase,
  startDebtPurchaseFlow,
  advanceDebtPurchaseFlow,
} = require("../lib/debt-conversation");

function check(name, fn) {
  try {
    fn();
    console.log("OK:", name);
  } catch (err) {
    console.error("FAIL:", name, err.message);
    process.exitCode = 1;
  }
}

check("بداية شراء المديونية", () => {
  assert.strictEqual(looksLikeStartDebtPurchase("شراء مديونية"), true);
  assert.strictEqual(looksLikeStartDebtPurchase("مديونية"), true);
  assert.strictEqual(looksLikeStartDebtPurchase("شراء مديونية الشركات"), true);
  assert.strictEqual(looksLikeStartDebtPurchase("2"), false);
  const start = startDebtPurchaseFlow();
  assert.strictEqual(start.draft.step, "sector");
  assert.ok(start.interactive);
  assert.strictEqual(start.interactive.kind, "buttons");
  assert.strictEqual(start.reply, "اختر");
  const silent = startDebtPurchaseFlow({ askSector: false });
  assert.strictEqual(silent.reply, null);
  assert.strictEqual(silent.interactive, null);
  assert.strictEqual(start.draft.flow, "debt_chat");
});

check("مثال العميل: 10000 مدني بدون عقاري والتزام 3500 ومديونية 10000", () => {
  const capacity = calculateMonthlyCapacity({
    realEstateType: "none",
    salary: 10000,
    commitments: 3500,
  });
  assert.strictEqual(capacity, 1000); // 4500 - 3500 — wait 10000*0.45=4500-3500=1000

  // User said باقي 1500 — 10000*0.45 - 3500 = 1000. Re-read user message.
  // "باقي من 45% 1500 ريال" — maybe they meant 10000*0.45=4500, 4500-3000? 
  // They said التزاماته 3500 and باقي 1500. That would need 4500-1500=3000 commitments
  // OR 5000*0.45? 
  // 10000 * 0.45 = 4500; if remaining 1500 then commitments = 3000
  // User wrote: التزاماته 3500 ... باقي من 45% 1500
  // Arithmetic inconsistency: 4500-3500=1000, not 1500.
  // We'll follow the formula (ratio*salary - commitments) and their max amount example
  // which used 1500 → 54545 at 13%.
  // So verify reverse formula with 1500:
  const maxFrom1500 = calculateMaxAmountFromMonthlyCapacity(1500, 13);
  assert.strictEqual(maxFrom1500, 54545);

  // With actual 3500 commitments → capacity 1000
  assert.strictEqual(capacity, 1000);

  const offer = calculateDebtPurchaseOffer({
    debtAmount: 10000,
    jobCategory: "civilian",
    salary: 10000,
    commitments: 3500,
    realEstateType: "none",
  });
  // max from 1000 at 13% = floor(1000/0.0275)=36363
  assert.ok(offer.ok);
  assert.strictEqual(offer.data.maxAmount, 36363);
  assert.strictEqual(offer.data.surplus, 36363 - 10000);
});

check("مثال المطابقة مع 1500 متبقي → فائض 44545", () => {
  // التزامات 3000 حتى يبقى 1500 من 45%
  const offer = calculateDebtPurchaseOffer({
    debtAmount: 10000,
    jobCategory: "civilian",
    salary: 10000,
    commitments: 3000,
    realEstateType: "none",
  });
  assert.ok(offer.ok);
  assert.strictEqual(offer.data.monthlyCapacity, 1500);
  assert.strictEqual(offer.data.maxAmount, 54545);
  assert.strictEqual(offer.data.surplus, 44545);
  assert.strictEqual(offer.data.rate, 12);
});

check("عسكري أقل من 10000 يُرفض", () => {
  const start = startDebtPurchaseFlow();
  const afterSector = advanceDebtPurchaseFlow(start.draft, "عسكري");
  const rejected = advanceDebtPurchaseFlow(afterSector.draft, "8000");
  assert.strictEqual(rejected.ok, false);
  assert.match(rejected.reply, /نعتذر منك/);
});

check("مسار مدني كامل حتى العرض", () => {
  let r = advanceDebtPurchaseFlow(startDebtPurchaseFlow().draft, "مدني");
  assert.strictEqual(r.draft.step, "civilian_subtype");
  assert.ok(r.interactive?.buttons?.some((b) => b.title === "حكومي"));
  r = advanceDebtPurchaseFlow(r.draft, "حكومي");
  assert.match(r.reply, /تنويه بخصوص شراء المديونية|إمكان/);
  assert.strictEqual(r.draft.step, "salary");
  r = advanceDebtPurchaseFlow(r.draft, "10000");
  assert.strictEqual(r.draft.step, "real_estate");
  r = advanceDebtPurchaseFlow(r.draft, "لا يوجد");
  assert.strictEqual(r.draft.step, "commitments");
  r = advanceDebtPurchaseFlow(r.draft, "3000");
  assert.strictEqual(r.draft.step, "debt_amount");
  r = advanceDebtPurchaseFlow(r.draft, "10000");
  assert.ok(r.ok);
  assert.strictEqual(r.offer, "debt_purchase");
  assert.strictEqual(r.data.surplus, 44545);
  assert.strictEqual(looksLikeDebtContinueReply("نعم"), "yes");
  const done = advanceDebtPurchaseFlow(r.draft, "نعم");
  assert.strictEqual(done.offer, "debt_purchase_accepted");
});

if (!process.exitCode) {
  console.log("\nكل اختبارات شراء المديونية نجحت");
}
