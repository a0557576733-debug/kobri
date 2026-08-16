const assert = require("assert");
const os = require("os");
const path = require("path");
const {
  detectCustomerOutcome,
  canAutoUpdateNotes,
  OUTCOMES,
} = require("../lib/customer-outcome");
const { createCustomerLedger } = require("../lib/customer-ledger");
const {
  buildPersonalApplyFollowUp,
  buildPropertyComboInterestAsk,
  replyPropertyComboDecision,
  calculatePersonalFinance,
} = require("../lib/personal-finance");
const { startServiceStopFlow } = require("../lib/main-menu");

assert.strictEqual(
  detectCustomerOutcome({
    offer: "order_number_received",
    reply: "تم استلام رقم الطلب",
    data: { orderNumber: "10123456" },
  }),
  OUTCOMES.ORDER_NUMBER
);

assert.strictEqual(
  detectCustomerOutcome({
    offer: "property_combo_accepted",
    reply: "للتواصل مع المندوب",
  }),
  OUTCOMES.PACKAGE
);

assert.strictEqual(
  detectCustomerOutcome({
    offer: "service_stop",
    draft: { flow: "main_menu", step: "awaiting_service_stop_qualify" },
  }),
  OUTCOMES.SERVICE_STOP
);

assert.strictEqual(
  detectCustomerOutcome({
    offer: "service_stop_accepted",
    silent: true,
  }),
  OUTCOMES.SERVICE_STOP
);

assert.strictEqual(
  detectCustomerOutcome(startServiceStopFlow()),
  OUTCOMES.SERVICE_STOP
);

assert.strictEqual(
  detectCustomerOutcome(buildPropertyComboInterestAsk({ reason: "low_amount" })),
  OUTCOMES.LIMIT_EXHAUSTED
);

assert.strictEqual(
  detectCustomerOutcome({
    ok: false,
    reply: "مستنفذ حد التمويل الشخصي نعتذر منك",
  }),
  OUTCOMES.LIMIT_EXHAUSTED
);

assert.strictEqual(
  detectCustomerOutcome({
    ok: true,
    reply: "تم حساب التمويل الشخصي",
    followUpReply: buildPersonalApplyFollowUp(),
  }),
  OUTCOMES.FINANCE_LINK
);

assert.strictEqual(
  detectCustomerOutcome(replyPropertyComboDecision("yes")),
  OUTCOMES.PACKAGE
);

assert.strictEqual(detectCustomerOutcome({ reply: "مرحبا" }), null);
assert.ok(canAutoUpdateNotes(""));
assert.ok(canAutoUpdateNotes("أخذ باقة"));
assert.ok(canAutoUpdateNotes("رقم طلب"));
assert.ok(!canAutoUpdateNotes("ملاحظة يدوية خاصة"));

const ledger = createCustomerLedger({
  dataFile: path.join(os.tmpdir(), `outcome-ledger-${Date.now()}.json`),
});
ledger.recordInbound("+966", "501112223", "مرحبا");
ledger.setOutcomeNotes("+966", "501112223", OUTCOMES.LIMIT_EXHAUSTED);
assert.strictEqual(
  ledger._customers.get("+966:501112223").outcome,
  OUTCOMES.LIMIT_EXHAUSTED
);
ledger.setNotes("+966", "501112223", "يتابع معايا بكرا");
assert.strictEqual(
  ledger._customers.get("+966:501112223").notes,
  "يتابع معايا بكرا"
);
assert.strictEqual(
  ledger._customers.get("+966:501112223").outcome,
  OUTCOMES.LIMIT_EXHAUSTED,
  "الملاحظة الحرة لا تمسح وش صار"
);
ledger.setOutcomeNotes("+966", "501112223", OUTCOMES.PACKAGE);
assert.strictEqual(
  ledger._customers.get("+966:501112223").outcome,
  OUTCOMES.PACKAGE
);
assert.strictEqual(
  ledger._customers.get("+966:501112223").notes,
  "يتابع معايا بكرا",
  "تحديث وش صار لا يمسح الملاحظة الحرة"
);

// ترحيل بيانات قديمة كانت داخل notes
ledger.recordInbound("+966", "509998887", "مرحبا");
const legacy = ledger._customers.get("+966:509998887");
legacy.notes = OUTCOMES.FINANCE_LINK;
legacy.outcome = "";
const after = ledger.setNotes("+966", "509998887", "ملاحظة جديدة");
assert.strictEqual(after.outcome, OUTCOMES.FINANCE_LINK);
assert.strictEqual(after.notes, "ملاحظة جديدة");

const okCalc = calculatePersonalFinance({
  jobCategory: "military",
  salary: 15000,
  commitments: 500,
  realEstateType: "none",
});
if (okCalc.ok && okCalc.followUpReply) {
  assert.strictEqual(detectCustomerOutcome(okCalc), OUTCOMES.FINANCE_LINK);
}

console.log("OK: customer outcome auto-detect");
