const assert = require("assert");
const {
  startPersonalFinanceFlow,
  advancePersonalFinanceFlow,
  realEstateStepReply,
} = require("../lib/conversation");

const re = realEstateStepReply({
  flow: "personal_chat",
  step: "real_estate",
  jobCategory: "civilian",
  salary: 8000,
  commitments: 1500,
});
assert.notStrictEqual(re.sendTextThenInteractive, true);
assert.ok(re.reply.includes("تمويل عقاري"));
assert.strictEqual(re.interactive?.kind, "list");
assert.ok(re.interactive.body.includes("هل عليك تمويل عقاري"));
assert.strictEqual(re.interactive.button, "اختر النوع");
assert.ok(!re.interactive.body.includes("1- لا يوجد عقاري"));

let draft = startPersonalFinanceFlow({ askSector: true }).draft;
draft = advancePersonalFinanceFlow(draft, "مدني").draft;
draft = advancePersonalFinanceFlow(draft, "حكومي").draft;
draft = advancePersonalFinanceFlow(draft, "8000").draft;
assert.strictEqual(draft.step, "commitments");

const afterCommitments = advancePersonalFinanceFlow(draft, "1500");
assert.strictEqual(afterCommitments.draft.step, "real_estate");
assert.notStrictEqual(afterCommitments.sendTextThenInteractive, true);
assert.ok(afterCommitments.interactive?.body.includes("عقاري"));
assert.strictEqual(afterCommitments.interactive?.kind, "list");

console.log("OK: بعد الالتزامات رسالة عقاري واحدة (قائمة فقط)");
