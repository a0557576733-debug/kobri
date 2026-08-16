const assert = require("assert");
const {
  looksLikeGreeting,
  looksLikeShowMainMenu,
  looksLikeMenuShortcut,
  showMainMenu,
  parseMainMenuChoice,
  handleMainMenuChoice,
} = require("../lib/main-menu");

const { looksLikeRestartFlow } = require("../lib/main-menu");
assert.strictEqual(looksLikeRestartFlow("إعادة"), true);
assert.strictEqual(looksLikeRestartFlow("اعادة"), true);
assert.strictEqual(looksLikeRestartFlow("من جديد"), true);
assert.strictEqual(looksLikeRestartFlow("مرحبا"), false);

assert.strictEqual(looksLikeGreeting("السلام عليكم"), true);
assert.strictEqual(looksLikeGreeting("السلام عليكم ورحمة الله وبركاته"), true);
assert.strictEqual(looksLikeGreeting("السلام"), true);
assert.strictEqual(looksLikeGreeting("السلام."), true);
assert.strictEqual(looksLikeGreeting("سلام"), true);
assert.strictEqual(looksLikeGreeting("مرحبا"), true);
assert.strictEqual(looksLikeGreeting("تمويل شخصي"), false);

assert.strictEqual(looksLikeShowMainMenu("السلام عليكم"), true);
assert.strictEqual(looksLikeShowMainMenu("قائمة"), true);
assert.strictEqual(looksLikeShowMainMenu("قائمة رئيسية"), true);
assert.strictEqual(looksLikeMenuShortcut("1"), true);
assert.strictEqual(looksLikeMenuShortcut("١"), true);
assert.strictEqual(looksLikeMenuShortcut("12"), false);
assert.strictEqual(looksLikeMenuShortcut("تمويل"), false);

const welcome = showMainMenu("السلام عليكم");
assert.ok(welcome.reply.includes("وعليكم السلام"));
assert.ok(welcome.interactive);
assert.strictEqual(welcome.interactive.kind, "list");
assert.strictEqual(welcome.interactive.rows.length, 7);
assert.ok(
  welcome.interactive.rows.some((r) => r.title === "تمويل شخصي")
);
assert.ok(
  welcome.interactive.rows.some((r) => r.title === "شراء مديونية")
);
assert.ok(
  welcome.interactive.rows.some((r) => r.title === "مبالغ التمويل")
);
assert.ok(
  !welcome.interactive.rows.some((r) => /إيقاف الرد/.test(r.title))
);
assert.strictEqual(welcome.draft.flow, "main_menu");

assert.strictEqual(parseMainMenuChoice("1"), "1");
assert.strictEqual(parseMainMenuChoice("تمويل شخصي"), "1");
assert.strictEqual(parseMainMenuChoice("شراء مديونية"), "2");
assert.strictEqual(parseMainMenuChoice("مبالغ التمويل"), "3");
assert.strictEqual(parseMainMenuChoice("إيقاف خدمات"), "4");
assert.strictEqual(parseMainMenuChoice("ساعات الدوام"), "5");
assert.strictEqual(parseMainMenuChoice("موقعنا"), "6");
assert.strictEqual(parseMainMenuChoice("رقم المساعد"), "7");
assert.strictEqual(parseMainMenuChoice("إيقاف الرد الآلي"), null);
assert.strictEqual(parseMainMenuChoice("xyz"), null);

const personal = handleMainMenuChoice("1");
assert.strictEqual(personal.startFlow, "personal");
const debt = handleMainMenuChoice("2");
assert.strictEqual(debt.startFlow, "debt");
const amounts = handleMainMenuChoice("3");
assert.strictEqual(amounts.draft.step, "awaiting_amount_examples_sector");
const hours = handleMainMenuChoice("5");
assert.ok(hours.reply.includes("الأحد") || hours.reply.includes("دوام"));
const assistant = handleMainMenuChoice("7");
assert.ok(assistant.reply.includes("ماجد"));
assert.ok(assistant.reply.includes("0507009290"));
assert.ok(!assistant.reply.includes("0501812339"));

const {
  startServiceStopFlow,
  advanceServiceStopFlow,
} = require("../lib/main-menu");
const stopStart = handleMainMenuChoice("4");
assert.strictEqual(stopStart.draft.step, "awaiting_service_stop_qualify");
assert.strictEqual(stopStart.interactive.kind, "buttons");
assert.match(stopStart.interactive.body, /7000/);

const stopYes = advanceServiceStopFlow(stopStart.draft, "نعم");
assert.strictEqual(stopYes.draft.step, "awaiting_service_stop_agent");
assert.match(stopYes.interactive.body, /تبي ارسلك رقم المندوب/);
assert.match(stopYes.interactive.body, /مليون|400/);

const stopAgentNo = advanceServiceStopFlow(stopYes.draft, "لا");
assert.match(stopAgentNo.reply, /بالتوفيق وحياك الله/);
assert.strictEqual(stopAgentNo.draft, null);

const stopAgentYes = advanceServiceStopFlow(
  { flow: "main_menu", step: "awaiting_service_stop_agent" },
  "نعم"
);
assert.strictEqual(stopAgentYes.silent, true);
assert.ok(!stopAgentYes.reply);
assert.ok(!stopAgentYes.interactive);

const stopQualifyNo = advanceServiceStopFlow(stopStart.draft, "لا");
assert.match(stopQualifyNo.reply, /بالتوفيق وحياك الله/);

console.log("test-main-menu: OK");
