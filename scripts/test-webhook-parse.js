const assert = require("assert");
const { extractIncomingMessage } = require("../lib/webhook-parse");
const {
  startPersonalFinanceFlow,
  advancePersonalFinanceFlow,
} = require("../lib/conversation");
const { mapSector } = require("../lib/personal-finance");

function check(name, fn) {
  try {
    fn();
    console.log("OK:", name);
  } catch (err) {
    console.error("FAIL:", name, err.message);
    process.exitCode = 1;
  }
}

check("button_text يتقدم على message الطويل", () => {
  const got = extractIncomingMessage({
    type: "message_api_clicked",
    data: {
      customer: {
        phone_number: "551850488",
        country_code: "+966",
      },
      message: {
        message_content_type: "Template",
        message:
          '[{"type":"body","parameters":[{"type":"text","text":"x"}]}]',
        button_text: "مدني",
        button_payload: {
          payload: { type: "QUICK_REPLY", text: "مدني" },
        },
      },
    },
  });
  assert.strictEqual(got.text, "مدني");
  assert.strictEqual(got.phone, "551850488");
});

check("interactive.button_reply.title", () => {
  const got = extractIncomingMessage({
    type: "message_received",
    data: {
      customer: {
        channel_phone_number: "966501234567",
        country_code: "+966",
      },
      message: {
        message_content_type: "InteractiveButtonReply",
        message: "",
        interactive: {
          type: "button_reply",
          button_reply: { id: "sec-1", title: "➦ متقاعد" },
        },
      },
    },
  });
  assert.strictEqual(got.text, "متقاعد");
  assert.strictEqual(got.phone, "501234567");
});

check("لا يأخذ نص الرسالة الأصلية بدل الزر", () => {
  const got = extractIncomingMessage({
    type: "message_received",
    data: {
      customer: { phone_number: "500000001", country_code: "+966" },
      message: {
        message: "✅ تمام نبدأ حسبة التمويل الشخصي. اختر قطاعك:",
        button_text: "عسكري",
      },
    },
  });
  assert.strictEqual(got.text, "عسكري");
});

check("mapSector يفهم مدني مع رمز السهم", () => {
  assert.strictEqual(mapSector("➦ مدني"), "civilian");
  assert.strictEqual(mapSector("civilian"), "civilian");
  assert.strictEqual(mapSector("2"), "retired");
});

check("ضغط مدني يكمل لسؤال الراتب", () => {
  const start = startPersonalFinanceFlow();
  assert.strictEqual(start.reply, null);
  assert.strictEqual(start.interactive, null);
  const subtype = advancePersonalFinanceFlow(start.draft, "مدني");
  assert.strictEqual(subtype.draft.step, "civilian_subtype");
  const next = advancePersonalFinanceFlow(subtype.draft, "حكومي");
  assert.ok(next.ok);
  assert.match(next.reply, /راتبك/);
  assert.match(next.reply, /4000 ريال/);
  assert.strictEqual(next.draft.step, "salary");
  assert.strictEqual(next.draft.jobCategory, "civilian");
});

check("مثال الراتب حسب القطاع", () => {
  const start = startPersonalFinanceFlow();
  const civilianSubtype = advancePersonalFinanceFlow(start.draft, "مدني");
  const civilian = advancePersonalFinanceFlow(civilianSubtype.draft, "حكومي");
  const retired = advancePersonalFinanceFlow(start.draft, "متقاعد");
  const military = advancePersonalFinanceFlow(start.draft, "عسكري");
  assert.match(civilian.reply, /مثال: 4000 ريال/);
  assert.match(retired.reply, /مثال: 4000 ريال/);
  assert.match(military.reply, /مثال: 10000 ريال/);
});

check("سيناريو الزر الفاشل سابقًا", () => {
  const start = startPersonalFinanceFlow();
  const extracted = extractIncomingMessage({
    type: "message_api_clicked",
    data: {
      customer: { phone_number: "551850488", country_code: "+966" },
      message: {
        message:
          "✅ تمام نبدأ حسبة التمويل الشخصي. اختر قطاعك:",
        button_text: "مدني",
      },
    },
  });
  const next = advancePersonalFinanceFlow(start.draft, extracted.text);
  assert.ok(next.ok, next.reply);
  assert.strictEqual(next.draft.jobCategory, "civilian");
  assert.strictEqual(next.draft.step, "civilian_subtype");
});

check("تمويل أثناء خطوة القطاع يعيد البدء بدون رد مكرر", () => {
  const stuck = {
    flow: "personal_chat",
    step: "sector",
  };
  const next = advancePersonalFinanceFlow(stuck, "تمويل");
  assert.strictEqual(next.draft.step, "sector");
  assert.ok(!next.draft.jobCategory);
  assert.ok(next.interactive?.kind === "buttons" || next.reply === null);
});

check("مدني راتبه أقل من 4000 يرفض فورًا", () => {
  const start = startPersonalFinanceFlow();
  const afterSector = advancePersonalFinanceFlow(start.draft, "مدني");
  const afterGov = advancePersonalFinanceFlow(afterSector.draft, "حكومي");
  const rejected = advancePersonalFinanceFlow(afterGov.draft, "3500");
  assert.strictEqual(rejected.ok, false);
  assert.match(rejected.reply, /نعتذر منك/);
  assert.match(rejected.reply, /4,000|4000/);
  assert.strictEqual(rejected.clearDraft, true);
  assert.strictEqual(rejected.draft, null);
});

check("مدني راتبه 4000 يكمل للالتزامات", () => {
  const start = startPersonalFinanceFlow();
  const afterSector = advancePersonalFinanceFlow(start.draft, "مدني");
  const afterGov = advancePersonalFinanceFlow(afterSector.draft, "حكومي");
  const next = advancePersonalFinanceFlow(afterGov.draft, "4000");
  assert.ok(next.ok);
  assert.match(next.reply, /التزامات/);
  assert.strictEqual(next.draft.step, "commitments");
});

check("عسكري أقل من 10000 يُسأل عن العقاري ثم باقة إذا لا يوجد", () => {
  const start = startPersonalFinanceFlow();
  const afterSector = advancePersonalFinanceFlow(start.draft, "عسكري");
  const afterSalary = advancePersonalFinanceFlow(afterSector.draft, "8000");
  assert.ok(afterSalary.ok);
  assert.match(afterSalary.reply, /عقاري/);
  assert.strictEqual(afterSalary.draft.step, "real_estate");
  assert.strictEqual(afterSalary.draft.militaryLowSalaryPath, true);

  const combo = advancePersonalFinanceFlow(afterSalary.draft, "لا يوجد");
  assert.ok(combo.ok);
  assert.strictEqual(combo.offer, "property_combo_interest");
  assert.match(combo.reply, /نعتذر منك|الراتب أقل/);
  assert.match(
    combo.interactive?.body || "",
    /حلول تمويلية أخرى|حلول تمويل/
  );
  assert.strictEqual(combo.interactive?.kind, "buttons");
  assert.strictEqual(combo.data.awaitingComboInterest, true);
  assert.strictEqual(combo.data.awaitingCombo, false);
});

check("عسكري أقل من 10000 مع عقاري يُرفض", () => {
  const start = startPersonalFinanceFlow();
  const afterSector = advancePersonalFinanceFlow(start.draft, "عسكري");
  const afterSalary = advancePersonalFinanceFlow(afterSector.draft, "8500");
  const rejected = advancePersonalFinanceFlow(afterSalary.draft, "مدعوم");
  assert.strictEqual(rejected.ok, false);
  assert.match(rejected.reply, /نعتذر منك/);
});

check("اختيار 1 للعقاري لا يُفسّر كبداية تمويل", () => {
  const { looksLikeStartPersonalFinance } = require("../lib/conversation");
  assert.strictEqual(looksLikeStartPersonalFinance("1"), false);
  assert.strictEqual(looksLikeStartPersonalFinance("تمويل"), true);

  const start = startPersonalFinanceFlow();
  const afterSector = advancePersonalFinanceFlow(start.draft, "عسكري");
  const afterSalary = advancePersonalFinanceFlow(afterSector.draft, "8000");
  const combo = advancePersonalFinanceFlow(afterSalary.draft, "1");
  assert.ok(combo.ok);
  assert.strictEqual(combo.offer, "property_combo_interest");
  assert.match(combo.reply, /نعتذر منك|الراتب أقل/);
  assert.match(combo.interactive?.body || "", /هل ترغب بحلول تمويلية أخرى/);
  const { replyPropertyComboInterestDecision } = require("../lib/personal-finance");
  const offer = replyPropertyComboInterestDecision("yes", combo.data);
  assert.strictEqual(offer.offer, "property_combo");
  assert.match(offer.interactive?.body || "", /هل ترغب بهذا العرض|عقاري/);
});

check("الراتب بالأرقام العربية يُقبل", () => {
  const start = startPersonalFinanceFlow();
  const afterSector = advancePersonalFinanceFlow(start.draft, "مدني");
  const afterGov = advancePersonalFinanceFlow(afterSector.draft, "حكومي");
  const next = advancePersonalFinanceFlow(afterGov.draft, "٨٠٠٠");
  assert.ok(next.ok, next.reply);
  assert.strictEqual(next.draft.salary, 8000);
  assert.match(next.reply, /التزامات/);
});

check("سؤال العقاري يرسل قائمة تفاعلية", () => {
  const {
    parseRealEstateChoice,
    realEstateInteractive,
  } = require("../lib/conversation");
  const start = startPersonalFinanceFlow();
  const afterSector = advancePersonalFinanceFlow(start.draft, "مدني");
  const afterGov = advancePersonalFinanceFlow(afterSector.draft, "حكومي");
  const afterSalary = advancePersonalFinanceFlow(afterGov.draft, "8000");
  const afterCommitments = advancePersonalFinanceFlow(afterSalary.draft, "0");
  assert.strictEqual(afterCommitments.draft.step, "real_estate");
  assert.ok(afterCommitments.interactive);
  assert.strictEqual(afterCommitments.interactive.kind, "list");
  assert.strictEqual(afterCommitments.interactive.rows.length, 4);
  assert.strictEqual(parseRealEstateChoice("re_none"), "none");
  assert.strictEqual(parseRealEstateChoice("لا يوجد عقاري"), "none");
  assert.strictEqual(realEstateInteractive().button, "اختر النوع");
});

if (!process.exitCode) {
  console.log("\nكل اختبارات webhook-parse نجحت");
}
