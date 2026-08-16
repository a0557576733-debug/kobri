const assert = require("assert");
const {
  buildQuickAmountsInteractive,
  buildHigherAmountsInteractive,
  higherAmountsList,
  askAmountExamplesSector,
  parseAmountExamplesSector,
  parseAmountExamplesCivilianSubtype,
  parseExampleAmount,
  looksLikeMoreAmounts,
  handleAmountExamplesSector,
  handleAmountExamplesCivilianSubtype,
  handleAmountExamplesPick,
  looksLikeAmountExamplesCta,
  QUICK_AMOUNTS,
} = require("../lib/amount-examples");
const {
  parseMainMenuChoice,
  handleMainMenuChoice,
  showMainMenu,
} = require("../lib/main-menu");

assert.strictEqual(parseMainMenuChoice("مبالغ التمويل"), "3");
assert.ok(
  showMainMenu("مرحبا").interactive.rows.some((r) => r.title === "مبالغ التمويل")
);

const ask = askAmountExamplesSector();
assert.strictEqual(ask.interactive.buttons.length, 3);
assert.strictEqual(parseAmountExamplesSector("متقاعد"), "retired");
assert.strictEqual(parseAmountExamplesCivilianSubtype("قطاع خاص"), "private");

const military = handleAmountExamplesSector("عسكري");
assert.strictEqual(military.draft.step, "awaiting_amount_examples_pick");
assert.strictEqual(military.interactive.kind, "list");
assert.strictEqual(military.interactive.rows.length, 4);
assert.deepStrictEqual(
  military.interactive.rows.slice(0, 3).map((r) => r.id),
  QUICK_AMOUNTS.map((a) => `ex_${a}`)
);
assert.strictEqual(military.interactive.rows[3].id, "ex_more");
assert.strictEqual(military.interactive.rows[3].title, "اختر مبالغ أعلى");

const afterCivilian = handleAmountExamplesSector("مدني");
assert.strictEqual(
  afterCivilian.draft.step,
  "awaiting_amount_examples_civilian_subtype"
);
const privatePick = handleAmountExamplesCivilianSubtype("قطاع خاص");
assert.strictEqual(privatePick.draft.step, "awaiting_amount_examples_pick");
assert.ok(privatePick.interactive.body.includes("قطاع خاص"));
assert.ok(privatePick.interactive.body.includes("15.50"));

const picked = handleAmountExamplesPick(privatePick.draft, "ex_15000");
assert.strictEqual(picked.draft.step, "awaiting_amount_examples_cta");
assert.ok(picked.reply.includes("15,000"));
assert.ok(picked.reply.includes("القسط"));
assert.strictEqual(picked.interactive.buttons[0].title, "تقدم بتمويلك الآن");

assert.strictEqual(parseExampleAmount("10,000 ريال"), 10000);
assert.strictEqual(parseExampleAmount("ex_20000"), 20000);
assert.ok(looksLikeMoreAmounts("اختر مبالغ أعلى"));

const more = handleAmountExamplesPick(privatePick.draft, "ex_more");
assert.strictEqual(more.draft.step, "awaiting_amount_examples_pick");
assert.ok(more.interactive.rows.some((r) => r.id === "ex_25000"));
assert.ok(more.interactive.rows.some((r) => r.id === "ex_30000"));
assert.ok(more.interactive.rows.length <= 10);

const higher = higherAmountsList();
assert.strictEqual(higher[0], 25000);
assert.ok(higher.includes(150000));
assert.ok(!higher.includes(10000));
assert.ok(!higher.includes(20000));

const page1 = buildHigherAmountsInteractive("civilian", 0);
assert.ok(page1.rows.some((r) => r.title === "مبالغ أعلى" || r.id.startsWith("ex_more")));

const pageLast = handleAmountExamplesPick(
  { amountExamplesSector: "civilian", amountExamplesPage: 0 },
  "ex_more_1"
);
assert.ok(pageLast.interactive.rows.length <= 10);

const quick = buildQuickAmountsInteractive("military");
assert.strictEqual(quick.rows.length, 4);

assert.strictEqual(looksLikeAmountExamplesCta("تقدم بتمويلك الآن"), true);
assert.strictEqual(handleMainMenuChoice("3").draft.step, "awaiting_amount_examples_sector");

console.log("test-amount-examples: OK");
