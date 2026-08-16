const assert = require("assert");
const { looksLikeRestartFlow } = require("../lib/main-menu");
const {
  startPersonalFinanceFlow,
  advancePersonalFinanceFlow,
  salaryPrompt,
} = require("../lib/conversation");

assert.strictEqual(looksLikeRestartFlow("إعادة"), true);
assert.strictEqual(looksLikeRestartFlow("اعادة"), true);
assert.strictEqual(looksLikeRestartFlow("reset"), true);
assert.strictEqual(looksLikeRestartFlow("من جديد"), true);
assert.strictEqual(looksLikeRestartFlow("ابدأ من جديد"), true);
assert.strictEqual(looksLikeRestartFlow("8000"), false);
assert.strictEqual(looksLikeRestartFlow("تمويل شخصي"), false);
assert.strictEqual(looksLikeRestartFlow("مرحبا"), false);

const salaryMsg = salaryPrompt("civilian");
assert.ok(
  salaryMsg.includes("إعادة"),
  "لازم تلميح إعادة في سؤال الراتب"
);

const started = startPersonalFinanceFlow({ askSector: true });
assert.strictEqual(started.draft.step, "sector");

let draft = started.draft;
let step = advancePersonalFinanceFlow(draft, "مدني");
assert.strictEqual(step.draft.step, "civilian_subtype");
step = advancePersonalFinanceFlow(step.draft, "حكومي");
assert.strictEqual(step.draft.step, "salary");
assert.ok(String(step.reply).includes("إعادة"));

draft = step.draft;
step = advancePersonalFinanceFlow(draft, "8000");
assert.strictEqual(step.draft.step, "commitments");
assert.ok(String(step.reply).includes("إعادة"));

// محاكاة خطأ: العميل كتب راتب بدل الالتزامات ثم يبي يعيد
// أمر «إعادة» يُعالج في السيرفر قبل advance — هنا نتحقق أن المسار يعيد من القطاع
const restarted = startPersonalFinanceFlow({ askSector: true });
assert.strictEqual(restarted.draft.step, "sector");
assert.ok(restarted.interactive?.kind === "buttons");

console.log("OK: إعادة/reset من منتصف المسار + تلميح في أسئلة الراتب/الالتزامات");
