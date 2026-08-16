const assert = require("assert");
const {
  qualifiesForPropertyCombo,
  resolveComboRejectReason,
} = require("../lib/calculations");
const { calculatePersonalFinance } = require("../lib/personal-finance");

// مدني مستنفذ حد + لا عقاري + راتب 7000+ + التزامات قليلة → لازم باقة
assert.strictEqual(
  qualifiesForPropertyCombo(
    { jobCategory: "civilian", salary: 8000, realEstate: "none" },
    12000,
    500
  ),
  true
);

assert.strictEqual(
  resolveComboRejectReason(
    { jobCategory: "civilian", salary: 8000, realEstate: "none" },
    12000,
    500
  ),
  "low_amount"
);

// عليه عقاري → لا باقة
assert.strictEqual(
  qualifiesForPropertyCombo(
    { jobCategory: "civilian", salary: 8000, realEstate: "supported" },
    12000,
    500
  ),
  false
);

// راتب تحت 7000 → لا باقة
assert.strictEqual(
  qualifiesForPropertyCombo(
    { jobCategory: "civilian", salary: 5000, realEstate: "none" },
    12000,
    500
  ),
  false
);

// حسبة كاملة: مستنفذ حد لازم يسأل عن حلول أخرى
const result = calculatePersonalFinance({
  jobCategory: "civilian",
  salary: 7000,
  commitments: 2500,
  realEstateType: "none",
  supportAmount: 0,
});
assert.ok(
  result.offer === "property_combo_interest" ||
    String(result.reply || "").includes("مستنفذ") ||
    result.sendTextThenInteractive,
  "مستنفذ حد مع شروط الباقة لازم مسار حلول أخرى"
);
if (result.data?.rounded != null && result.data.rounded < 15000) {
  assert.strictEqual(result.offer, "property_combo_interest");
  assert.ok(result.interactive?.kind === "buttons");
}

console.log("OK: مستنفذ حد → عرض الباقة (حلول تمويلية أخرى)");
