/**
 * سيرفر الحاسبة + Webhook Interakt
 * يشتغل على جهاز البيت (جهاز عبدالرحمن)
 *
 * التدفق:
 * 1) العميل يرسل بيانات التمويل → نحسب أعلى مبلغ + قائمة أقل
 * 2) إذا أرسل مبلغ من القائمة → نحسب قسط المبلغ المختار
 */
require("dotenv").config();
const express = require("express");
const {
  parsePersonalFinanceMessage,
  looksLikePersonalFinanceData,
  looksLikeSectorOnlyReply,
  looksLikeYesNoReply,
  calculatePersonalFinance,
  looksLikeAmountChoice,
  parseAmountChoice,
  calculateSelectedAmount,
  confirmLowerAmountSuggestion,
  looksLikeWantLowerAmount,
  beginLowerAmountFlow,
  applyLowerAmountTerm,
  parseLoanTermChoice,
  loanTermChoiceInteractive,
  replyPropertyComboDecision,
  replyPropertyComboInterestDecision,
  mapSector,
} = require("./lib/personal-finance");
const {
  looksLikeStartPersonalFinance,
  startPersonalFinanceFlow,
  advancePersonalFinanceFlow,
} = require("./lib/conversation");
const {
  looksLikeStartDebtPurchase,
  startDebtPurchaseFlow,
  advanceDebtPurchaseFlow,
} = require("./lib/debt-conversation");
const {
  looksLikeDebtContinueReply,
  buildDebtPurchaseComplete,
  buildDebtPurchaseDeclined,
} = require("./lib/debt-purchase");
const {
  looksLikeShowMainMenu,
  looksLikeMenuShortcut,
  looksLikeRestartFlow,
  showMainMenu,
  parseMainMenuChoice,
  handleMainMenuChoice,
  advanceServiceStopFlow,
} = require("./lib/main-menu");
const {
  handleAmountExamplesSector,
  handleAmountExamplesCivilianSubtype,
  handleAmountExamplesPick,
  looksLikeAmountExamplesCta,
} = require("./lib/amount-examples");
const { extractIncomingMessage } = require("./lib/webhook-parse");
const { normalizeDigits } = require("./lib/digits");
const { mountAdmin } = require("./lib/admin-routes");
const { createCustomerLedger } = require("./lib/customer-ledger");
const { detectCustomerOutcome } = require("./lib/customer-outcome");
const {
  looksLikeApplicationOrderNumber,
  parseApplicationOrderNumber,
  buildOrderNumberAckReply,
} = require("./lib/order-number");
const CONFIG = require("./config");

function normalizeEnvValue(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\r\n]/g, "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = Number(process.env.PORT || 5055);
const INTERAKT_API_KEY = normalizeEnvValue(process.env.INTERAKT_API_KEY);
const WEBHOOK_SECRET = normalizeEnvValue(process.env.WEBHOOK_SECRET);
const ADMIN_TOKEN = normalizeEnvValue(process.env.ADMIN_TOKEN);

/** جلسات مؤقتة: phone -> نتيجة الحسبة (أعلى مبلغ + نسبة) */
const sessions = new Map();
/** مسودات ناقصة: phone -> بيانات الراتب/الالتزامات بانتظار القطاع */
const drafts = new Map();
/** محادثات أوقف العميل فيها الرد الآلي (خيار 6) */
const pausedChats = new Set();
const SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6 ساعات
const customerLedger = createCustomerLedger();

function sessionKey(countryCode, phone) {
  return `${countryCode}:${phone}`;
}

function saveSession(countryCode, phone, data) {
  sessions.set(sessionKey(countryCode, phone), {
    data,
    savedAt: Date.now(),
  });
}

function getSession(countryCode, phone) {
  const key = sessionKey(countryCode, phone);
  const row = sessions.get(key);
  if (!row) return null;
  if (Date.now() - row.savedAt > SESSION_TTL_MS) {
    sessions.delete(key);
    return null;
  }
  return row.data;
}

function saveDraft(countryCode, phone, data) {
  drafts.set(sessionKey(countryCode, phone), {
    data,
    savedAt: Date.now(),
  });
}

function getDraft(countryCode, phone) {
  const key = sessionKey(countryCode, phone);
  const row = drafts.get(key);
  if (!row) return null;
  if (Date.now() - row.savedAt > SESSION_TTL_MS) {
    drafts.delete(key);
    return null;
  }
  return row.data;
}

function clearDraft(countryCode, phone) {
  drafts.delete(sessionKey(countryCode, phone));
}

function clearSession(countryCode, phone) {
  sessions.delete(sessionKey(countryCode, phone));
}

function isChatPaused(countryCode, phone) {
  return pausedChats.has(sessionKey(countryCode, phone));
}

function pauseChat(countryCode, phone) {
  pausedChats.add(sessionKey(countryCode, phone));
}

function resumeChat(countryCode, phone) {
  pausedChats.delete(sessionKey(countryCode, phone));
}

app.get("/health", (_req, res) => {
  let customers = null;
  try {
    const summary = customerLedger.summary();
    const persistence = customerLedger.persistenceInfo();
    customers = {
      today: summary?.counts?.today || 0,
      yesterday: summary?.counts?.yesterday || 0,
      all: summary?.counts?.all || 0,
      durable: Boolean(persistence?.durable),
      dataDir: persistence?.dataDir || null,
    };
  } catch (err) {
    customers = { error: err.message };
  }
  res.json({
    ok: true,
    service: "finance-calc-server",
    interaktConfigured: Boolean(INTERAKT_API_KEY),
    adminConfigured: Boolean(ADMIN_TOKEN),
    activeSessions: sessions.size,
    drafts: drafts.size,
    paused: pausedChats.size,
    customers,
  });
});

/** اختبار الحسبة مباشرة */
app.post("/calculate/personal", (req, res) => {
  const body = req.body || {};
  let input = body;

  if (body.message || body.text) {
    input = parsePersonalFinanceMessage(body.message || body.text);
  }

  const result = calculatePersonalFinance(input);
  res.status(result.ok ? 200 : 400).json(result);
});

/** اختبار اختيار مبلغ أقل */
app.post("/calculate/select-amount", (req, res) => {
  const body = req.body || {};
  const sessionData = body.session || body.data || {};
  const amount =
    body.amount != null ? Number(body.amount) : parseAmountChoice(body.message || body.text || "");
  const result = calculateSelectedAmount(sessionData, amount);
  res.status(result.ok ? 200 : 400).json(result);
});

async function postInteraktPayload(payload) {
  if (!INTERAKT_API_KEY) {
    throw new Error("INTERAKT_API_KEY غير موجود في ملف .env");
  }

  let response;
  try {
    response = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: {
        Authorization: `Basic ${INTERAKT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (netErr) {
    const cause = netErr?.cause;
    const detail = [
      netErr.message,
      cause?.code,
      cause?.message,
      cause?.hostname,
    ]
      .filter(Boolean)
      .join(" | ");
    const err = new Error(`فشل الاتصال بـ Interakt: ${detail}`);
    err.details = {
      hint: "تأكد من الإنترنت على الجهاز، وأن جدار الحماية لا يمنع Node.js",
      causeCode: cause?.code || null,
    };
    throw err;
  }

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(`Interakt API ${response.status}`);
    err.details = json;
    throw err;
  }

  return json;
}

async function sendInteraktText(countryCode, phoneNumber, message) {
  return postInteraktPayload({
    countryCode,
    phoneNumber,
    type: "Text",
    data: {
      message,
    },
  });
}

/** أزرار Quick Reply أو قائمة InteractiveList عبر Interakt */
async function sendInteraktInteractive(countryCode, phoneNumber, interactive) {
  if (!interactive || !interactive.kind) {
    throw new Error("interactive payload ناقص");
  }

  if (interactive.kind === "buttons") {
    const buttons = (interactive.buttons || []).slice(0, 3).map((b) => ({
      type: "reply",
      reply: {
        id: String(b.id || b.title),
        title: String(b.title).slice(0, 20),
      },
    }));
    return postInteraktPayload({
      countryCode,
      phoneNumber,
      type: "InteractiveButton",
      data: {
        message: {
          type: "button",
          body: { text: String(interactive.body || "").slice(0, 1024) },
          action: { buttons },
        },
      },
    });
  }

  if (interactive.kind === "list") {
    const rows = (interactive.rows || []).slice(0, 10).map((row) => ({
      id: String(row.id),
      title: String(row.title).slice(0, 24),
      description: row.description
        ? String(row.description).slice(0, 72)
        : undefined,
    }));
    return postInteraktPayload({
      countryCode,
      phoneNumber,
      type: "InteractiveList",
      data: {
        message: {
          type: "list",
          body: { text: String(interactive.body || "").slice(0, 1024) },
          action: {
            button: String(interactive.button || "اختر").slice(0, 20),
            sections: [
              {
                title: String(interactive.sectionTitle || "الخيارات").slice(
                  0,
                  24
                ),
                rows,
              },
            ],
          },
        },
      },
    });
  }

  throw new Error(`نوع interactive غير مدعوم: ${interactive.kind}`);
}

async function sendResultReply(countryCode, phone, result) {
  // نص أولًا ثم تفاعل (مثل: سبب الرفض ثم أزرار الباقة / أعلى مبلغ ثم قائمة أقل)
  if (result?.sendTextThenInteractive && result?.reply && result?.interactive) {
    await sendInteraktText(countryCode, phone, result.reply);
    if (result.followUpReply) {
      await sendInteraktText(countryCode, phone, result.followUpReply);
    }
    await sendInteraktInteractive(countryCode, phone, result.interactive);
    return result.followUpReply
      ? "text+followup+interactive"
      : "text+interactive";
  }
  if (result?.interactive) {
    await sendInteraktInteractive(countryCode, phone, result.interactive);
    if (result.followUpReply) {
      await sendInteraktText(countryCode, phone, result.followUpReply);
    }
    return result.followUpReply ? "interactive+followup" : "interactive";
  }
  if (result?.reply) {
    await sendInteraktText(countryCode, phone, result.reply);
    if (result.followUpReply) {
      await sendInteraktText(countryCode, phone, result.followUpReply);
    }
    return result.followUpReply ? "text+followup" : "text";
  }
  return null;
}

/**
 * Webhook من Interakt — فعّله من Developer Settings
 * URL مثال: https://xxxx.trycloudflare.com/webhook/interakt
 */
app.post("/webhook/interakt", async (req, res) => {
  try {
    if (WEBHOOK_SECRET) {
      const got =
        req.get("x-interakt-secret") ||
        req.get("x-webhook-secret") ||
        req.query.secret ||
        "";
      if (String(got) !== WEBHOOK_SECRET) {
        return res.status(401).json({ ok: false, error: "invalid secret" });
      }
    }

    // رد سريع لـ Interakt (مهم)
    res.status(200).json({ ok: true, received: true });

    const payload = req.body || {};
    const type = payload?.type || payload?.event || "";
    const { text, phone, countryCode, contentType, eventType } =
      extractIncomingMessage(payload);

    console.log("[webhook]", {
      type: type || eventType,
      phone,
      contentType,
      preview: text.slice(0, 80),
      messageKeys: Object.keys(payload?.data?.message || {}),
      hasButtonText: Boolean(payload?.data?.message?.button_text),
    });

    // تجاهل التسليم/القراءة؛ نقبل الوارد + اختصار المكتب (1) حتى لو message_api_sent
    const isOutboundSent = /^message_api_sent$/i.test(String(type));
    const ignoredTypes =
      /^(message_api_sent|message_api_delivered|message_api_read|message_api_failed|message_campaign_)/i;
    const staffMenuShortcut =
      isOutboundSent && phone && text && looksLikeMenuShortcut(text);
    if (
      type &&
      ignoredTypes.test(String(type)) &&
      !payload?.data?.message?.button_text &&
      !staffMenuShortcut
    ) {
      return;
    }

    if (!phone || !text) return;

    let result = null;
    const yesNo = looksLikeYesNoReply(text);
    const currentSession = getSession(countryCode, phone);
    const draft = getDraft(countryCode, phone);

    // سجل العميل في لوحة التحكم (اليوم / أمس)
    customerLedger.recordInbound(countryCode, phone, text, {
      flow: draft?.flow || currentSession?.offer || null,
      step: draft?.step || null,
      maxAmount: currentSession?.maxAmount || currentSession?.rounded || null,
      companyName: draft?.companyName || currentSession?.companyName || null,
      jobCategory: draft?.jobCategory || currentSession?.jobCategory || null,
      civilianSubtype:
        draft?.civilianSubtype || currentSession?.civilianSubtype || null,
    });

    // داخل مسار/اختيار قائمة: الرقم 1 له معنى ثاني (لا نعيد القائمة)
    const inActiveChoice =
      (draft?.flow === "main_menu" &&
        (draft.step === "awaiting_choice" ||
          draft.step === "awaiting_amount_examples_sector" ||
          draft.step === "awaiting_amount_examples_civilian_subtype" ||
          draft.step === "awaiting_amount_examples_pick" ||
          draft.step === "awaiting_amount_examples_cta" ||
          draft.step === "awaiting_service_stop_qualify" ||
          draft.step === "awaiting_service_stop_agent")) ||
      (draft?.flow === "personal_chat" &&
        draft.step &&
        draft.step !== "done") ||
      (draft?.flow === "debt_chat" && draft.step && draft.step !== "done") ||
      currentSession?.awaitingCombo ||
      currentSession?.awaitingComboInterest ||
      currentSession?.awaitingDebtContinue ||
      currentSession?.awaitingLowerAmountConfirm ||
      currentSession?.awaitingLowerAmountEntry ||
      currentSession?.awaitingLowerAmountTerm ||
      draft?.awaitingCombo ||
      draft?.awaitingComboInterest ||
      draft?.awaitingDebtContinue;

    // السلام / قائمة / اختصار المكتب (1) → القائمة الرئيسية
    if (
      looksLikeShowMainMenu(text) ||
      staffMenuShortcut ||
      (!inActiveChoice && looksLikeMenuShortcut(text))
    ) {
      result = showMainMenu(text);
      resumeChat(countryCode, phone);
      clearDraft(countryCode, phone);
      clearSession(countryCode, phone);
      saveDraft(countryCode, phone, result.draft);
    } else if (looksLikeRestartFlow(text)) {
      // راتب/التزامات خطأ أو رغبة بالتصفير: نبدأ المسار الحالي من جديد
      resumeChat(countryCode, phone);
      const inPersonal =
        draft?.flow === "personal_chat" ||
        Boolean(
          currentSession?.maxAmount ||
            currentSession?.rounded ||
            currentSession?.awaitingAmountChoice ||
            currentSession?.awaitingCombo ||
            currentSession?.awaitingComboInterest
        );
      const inDebt =
        draft?.flow === "debt_chat" ||
        Boolean(currentSession?.awaitingDebtContinue);

      clearDraft(countryCode, phone);
      clearSession(countryCode, phone);

      if (inPersonal && !inDebt) {
        result = startPersonalFinanceFlow({ askSector: true });
        result = {
          ...result,
          reply: "تم تصفير البيانات. نبدأ من جديد.",
          sendTextThenInteractive: Boolean(result.interactive),
        };
        saveDraft(countryCode, phone, result.draft);
      } else if (inDebt) {
        result = startDebtPurchaseFlow({ askSector: true });
        result = {
          ...result,
          reply: "تم تصفير البيانات. نبدأ من جديد.",
          sendTextThenInteractive: Boolean(result.interactive),
        };
        saveDraft(countryCode, phone, result.draft);
      } else {
        result = showMainMenu("قائمة");
        saveDraft(countryCode, phone, result.draft);
      }
    } else if (isChatPaused(countryCode, phone)) {
      // محادثة موقوفة: لا نرد إلا بعد سلام / قائمة / اختصار
      return;
    } else if (
      draft?.flow === "main_menu" &&
      draft.step === "awaiting_amount_examples_sector"
    ) {
      result = handleAmountExamplesSector(text);
      if (result.draft) saveDraft(countryCode, phone, result.draft);
      else clearDraft(countryCode, phone);
    } else if (
      draft?.flow === "main_menu" &&
      draft.step === "awaiting_amount_examples_civilian_subtype"
    ) {
      result = handleAmountExamplesCivilianSubtype(text);
      if (result.draft) saveDraft(countryCode, phone, result.draft);
      else clearDraft(countryCode, phone);
    } else if (
      draft?.flow === "main_menu" &&
      draft.step === "awaiting_amount_examples_pick"
    ) {
      result = handleAmountExamplesPick(draft, text);
      if (result.draft) saveDraft(countryCode, phone, result.draft);
      else clearDraft(countryCode, phone);
    } else if (
      looksLikeAmountExamplesCta(text) &&
      (draft?.step === "awaiting_amount_examples_cta" ||
        draft?.step === "awaiting_amount_examples_sector" ||
        draft?.step === "awaiting_amount_examples_civilian_subtype" ||
        draft?.step === "awaiting_amount_examples_pick" ||
        draft?.step === "awaiting_choice" ||
        !draft)
    ) {
      // زر «تقدم بتمويلك الآن» — لازم نسأل القطاع (ما نعتمد على Auto Reply)
      clearSession(countryCode, phone);
      result = startPersonalFinanceFlow({ askSector: true });
      saveDraft(countryCode, phone, result.draft);
    } else if (
      draft?.flow === "main_menu" &&
      draft.step === "awaiting_amount_examples_cta"
    ) {
      // ضغط/رد غير مفهوم بعد الأمثلة → نعيد الزر أو نبدأ التمويل
      clearSession(countryCode, phone);
      result = startPersonalFinanceFlow({ askSector: true });
      saveDraft(countryCode, phone, result.draft);
    } else if (
      draft?.flow === "main_menu" &&
      (draft.step === "awaiting_service_stop_qualify" ||
        draft.step === "awaiting_service_stop_agent")
    ) {
      result = advanceServiceStopFlow(draft, text, yesNo);
      if (result.clearDraft || result.draft == null) {
        clearDraft(countryCode, phone);
      } else if (result.draft) {
        saveDraft(countryCode, phone, result.draft);
      }
      if (result.silent) {
        const silentOutcome = detectCustomerOutcome(result);
        if (silentOutcome) {
          customerLedger.setOutcomeNotes(countryCode, phone, silentOutcome);
          console.log("[outcome:auto]", phone, silentOutcome, "(silent)");
        }
        return;
      }
    } else if (
      draft?.flow === "main_menu" &&
      draft.step === "awaiting_choice" &&
      parseMainMenuChoice(text)
    ) {
      const menuResult = handleMainMenuChoice(parseMainMenuChoice(text));
      if (menuResult.pauseChat) {
        pauseChat(countryCode, phone);
        clearDraft(countryCode, phone);
        clearSession(countryCode, phone);
        result = menuResult;
      } else if (menuResult.startFlow === "personal") {
        result = startPersonalFinanceFlow();
        saveDraft(countryCode, phone, result.draft);
      } else if (menuResult.startFlow === "debt") {
        result = startDebtPurchaseFlow();
        saveDraft(countryCode, phone, result.draft);
      } else {
        result = menuResult;
        if (result.clearDraft) clearDraft(countryCode, phone);
        else if (result.draft) saveDraft(countryCode, phone, result.draft);
      }
    } else if (
      yesNo &&
      (currentSession?.awaitingComboInterest || draft?.awaitingComboInterest)
    ) {
      const sessionBase = { ...(currentSession || {}), ...(draft || {}) };
      result = replyPropertyComboInterestDecision(yesNo, sessionBase);
      if (result.data?.awaitingCombo) {
        saveSession(countryCode, phone, result.data);
        saveDraft(countryCode, phone, {
          flow: "personal_chat",
          step: "done",
          ...result.data,
        });
      } else {
        clearDraft(countryCode, phone);
        saveSession(countryCode, phone, {
          ...sessionBase,
          awaitingComboInterest: false,
          awaitingCombo: false,
          comboInterestDecision: yesNo,
        });
      }
    } else if (yesNo && (currentSession?.awaitingCombo || draft?.awaitingCombo)) {
      result = replyPropertyComboDecision(yesNo);
      saveSession(countryCode, phone, {
        ...(currentSession || draft || {}),
        awaitingCombo: false,
        awaitingComboInterest: false,
        comboDecision: yesNo,
      });
      clearDraft(countryCode, phone);
    } else if (yesNo && currentSession?.awaitingLowerAmountConfirm) {
      result = confirmLowerAmountSuggestion(currentSession, yesNo);
      if (result?.data) {
        saveSession(countryCode, phone, result.data);
      }
    } else if (
      looksLikeWantLowerAmount(text) &&
      (currentSession?.awaitingLowerAmountEntry ||
        currentSession?.maxAmount ||
        currentSession?.rounded)
    ) {
      result = beginLowerAmountFlow(currentSession || {});
      if (result?.data) saveSession(countryCode, phone, result.data);
    } else if (currentSession?.awaitingLowerAmountTerm) {
      const allowed = currentSession.availableYearsForAmount;
      const years = parseLoanTermChoice(text, allowed);
      if (!years) {
        result = {
          ok: false,
          reply: "اختر مدة التمويل من الأزرار.",
          interactive: loanTermChoiceInteractive(allowed),
        };
      } else {
        result = applyLowerAmountTerm(currentSession, years);
        if (result?.data) saveSession(countryCode, phone, result.data);
      }
    } else if (
      looksLikeDebtContinueReply(text) &&
      (currentSession?.awaitingDebtContinue || draft?.awaitingDebtContinue)
    ) {
      const choice = looksLikeDebtContinueReply(text);
      result =
        choice === "yes"
          ? buildDebtPurchaseComplete()
          : buildDebtPurchaseDeclined();
      clearDraft(countryCode, phone);
      saveSession(countryCode, phone, {
        ...(currentSession || draft || {}),
        awaitingDebtContinue: false,
      });
    } else if (looksLikePersonalFinanceData(text)) {
      // ما زال يدعم إرسال كل البيانات دفعة واحدة
      const parsed = parsePersonalFinanceMessage(text);
      result = calculatePersonalFinance(parsed);
      if (result.ok && result.data) {
        clearDraft(countryCode, phone);
        saveSession(countryCode, phone, result.data);
      } else if (!parsed.jobCategory) {
        saveDraft(countryCode, phone, parsed);
      }
    } else if (looksLikeStartPersonalFinance(text)) {
      clearSession(countryCode, phone);
      result = startPersonalFinanceFlow();
      saveDraft(countryCode, phone, result.draft);
    } else if (looksLikeStartDebtPurchase(text)) {
      clearSession(countryCode, phone);
      result = startDebtPurchaseFlow();
      saveDraft(countryCode, phone, result.draft);
    } else if (draft?.flow === "personal_chat" && draft.step && draft.step !== "done") {
      result = advancePersonalFinanceFlow(draft, text);
      if (result.clearDraft || result.draft == null) {
        clearDraft(countryCode, phone);
      } else if (result.draft) {
        saveDraft(countryCode, phone, result.draft);
      }
      if (result.sessionData) {
        const keepComboDraft =
          result.sessionData.awaitingComboInterest ||
          result.sessionData.awaitingCombo;
        if (keepComboDraft) {
          if (result.draft) saveDraft(countryCode, phone, result.draft);
          saveSession(countryCode, phone, result.sessionData);
        } else {
          clearDraft(countryCode, phone);
          saveSession(countryCode, phone, result.sessionData);
        }
      } else if (
        result.data?.awaitingCombo ||
        result.data?.awaitingComboInterest
      ) {
        saveSession(countryCode, phone, result.data);
        if (result.draft) saveDraft(countryCode, phone, result.draft);
      }
    } else if (draft?.flow === "debt_chat" && draft.step && draft.step !== "done") {
      result = advanceDebtPurchaseFlow(draft, text);
      if (result.clearDraft || result.draft == null) {
        clearDraft(countryCode, phone);
      } else if (result.draft) {
        saveDraft(countryCode, phone, result.draft);
      }
      if (result.sessionData) {
        if (!result.draft || result.clearDraft) clearDraft(countryCode, phone);
        saveSession(countryCode, phone, result.sessionData);
      } else if (
        result.data?.awaitingCombo ||
        result.data?.awaitingComboInterest
      ) {
        saveSession(countryCode, phone, result.data);
        if (result.draft) saveDraft(countryCode, phone, result.draft);
      }
    } else if (looksLikeSectorOnlyReply(text)) {
      if (!draft) return;
      const merged = {
        ...draft,
        sectorRaw: text,
        jobCategory: mapSector(text),
      };
      result = calculatePersonalFinance(merged);
      if (result.ok && result.data) {
        clearDraft(countryCode, phone);
        saveSession(countryCode, phone, result.data);
      }
    } else if (looksLikeApplicationOrderNumber(text)) {
      // رقم طلب التقديم (يبدأ بـ 101 وطوله 8) — قبل اختيار المبلغ حتى ما ينحسب كمبلغ تمويل
      const orderNumber = parseApplicationOrderNumber(text);
      const prev = getSession(countryCode, phone) || {};
      const orderNumberAt = new Date().toISOString();
      saveSession(countryCode, phone, {
        ...prev,
        orderNumber,
        orderNumberAt,
        awaitingAmountChoice: false,
      });
      customerLedger.setOrderNumber(countryCode, phone, orderNumber);
      customerLedger.updateState(countryCode, phone, {
        orderNumber,
        orderNumberAt,
        flow: "order_number",
        step: "received",
      });
      result = {
        ok: true,
        reply: buildOrderNumberAckReply(CONFIG.messages),
        offer: "order_number_received",
        data: { orderNumber },
      };
    } else if (looksLikeAmountChoice(text)) {
      const sessionData = getSession(countryCode, phone);
      if (sessionData?.awaitingCombo || sessionData?.awaitingComboInterest) return;
      if (!sessionData?.maxAmount && !sessionData?.rounded) return;
      const amount = parseAmountChoice(text);
      result = calculateSelectedAmount(sessionData || {}, amount);
      // احفظ الجلسة عشان يقدر يغيّر المبلغ لاحقًا (مثل من 15,000 إلى 10,000)
      if (result?.ok && result.data) {
        saveSession(countryCode, phone, result.data);
      }
    } else if (!draft && parseMainMenuChoice(text)) {
      // عناوين القائمة بدون مسودة — نتجاهل الأرقام وحدها لتجنب التضارب
      const choice = parseMainMenuChoice(text);
      if (/^[1-7]$/.test(normalizeDigits(text).trim())) return;
      const menuResult = handleMainMenuChoice(choice);
      if (menuResult.pauseChat) {
        pauseChat(countryCode, phone);
        result = menuResult;
      } else if (menuResult.startFlow === "personal") {
        result = startPersonalFinanceFlow();
        saveDraft(countryCode, phone, result.draft);
      } else if (menuResult.startFlow === "debt") {
        result = startDebtPurchaseFlow();
        saveDraft(countryCode, phone, result.draft);
      } else {
        result = menuResult;
        if (result.draft) saveDraft(countryCode, phone, result.draft);
      }
    } else {
      return;
    }

    if (!result?.reply && !result?.interactive) return;

    try {
      const mode = await sendResultReply(countryCode, phone, result);
      const latestDraft = getDraft(countryCode, phone);
      const latestSession = getSession(countryCode, phone);
      const preview =
        result.reply ||
        result.followUpReply ||
        result.interactive?.body ||
        mode ||
        "";
      customerLedger.recordOutbound(countryCode, phone, preview, {
        mode,
        flow:
          result.flow ||
          latestDraft?.flow ||
          result.offer ||
          latestSession?.offer ||
          null,
        step: latestDraft?.step || null,
        maxAmount:
          result.data?.maxAmount ||
          result.data?.rounded ||
          latestSession?.maxAmount ||
          latestSession?.rounded ||
          null,
        companyName:
          result.data?.companyName ||
          latestDraft?.companyName ||
          latestSession?.companyName ||
          null,
        jobCategory:
          result.data?.jobCategory ||
          latestDraft?.jobCategory ||
          latestSession?.jobCategory ||
          null,
        civilianSubtype:
          result.data?.civilianSubtype ||
          latestDraft?.civilianSubtype ||
          latestSession?.civilianSubtype ||
          null,
      });
      // تحديث «وش صار» تلقائياً: رابط تمويل / باقة / مستنفذ حد / رقم طلب
      const outcome = detectCustomerOutcome(result);
      if (outcome) {
        customerLedger.setOutcomeNotes(countryCode, phone, outcome);
        console.log("[outcome:auto]", phone, outcome);
      }
      console.log(
        "[reply:ok]",
        phone,
        mode,
        result.ok,
        result.offer || result.flow || ""
      );
    } catch (err) {
      console.error("[reply:fail]", err.message, err.details || "");
      // إذا فشلت القائمة/الأزرار، حاول النص الاحتياطي
      if (result?.interactive && result?.reply) {
        try {
          await sendInteraktText(countryCode, phone, result.reply);
          customerLedger.recordOutbound(countryCode, phone, result.reply, {
            mode: "fallback-text",
          });
          console.log("[reply:fallback-text:ok]", phone);
        } catch (err2) {
          console.error("[reply:fallback-text:fail]", err2.message);
        }
      }
    }
  } catch (err) {
    console.error("[webhook:error]", err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false });
    }
  }
});

mountAdmin(app, {
  adminToken: ADMIN_TOKEN,
  sessions,
  drafts,
  pausedChats,
  sessionKey,
  clearDraft,
  clearSession,
  pauseChat,
  resumeChat,
  isChatPaused,
  saveDraft,
  sendInteraktText,
  sendResultReply,
  showMainMenu,
  interaktConfigured: Boolean(INTERAKT_API_KEY),
  interaktApiKey: INTERAKT_API_KEY,
  customerLedger,
});

function gracefulShutdown(signal) {
  try {
    customerLedger.createSnapshot(`shutdown-${signal}`);
    customerLedger.flush();
    console.log(`[shutdown] تم حفظ سجل العملاء قبل الإيقاف (${signal})`);
  } catch (err) {
    console.error("[shutdown:ledger]", err.message);
  }
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

app.listen(PORT, () => {
  console.log(`finance-calc-server على المنفذ ${PORT}`);
  console.log(`Health: http://127.0.0.1:${PORT}/health`);
  console.log(`Webhook: http://127.0.0.1:${PORT}/webhook/interakt`);
  console.log(`Admin: http://127.0.0.1:${PORT}/admin`);
  try {
    const persistence = customerLedger.persistenceInfo();
    console.log(
      `[customers] ${persistence.count} عميل · ${persistence.durable ? "قرص دائم" : "تخزين مؤقت"} · ${persistence.dataFile}`
    );
    if (!persistence.durable) {
      console.log(
        "[customers] تنبيه: أضف Persistent Disk على /var/data واضبط CUSTOMERS_DATA_DIR=/var/data/kobri حتى لا يُمسح السجل بعد إعادة التشغيل"
      );
    }
  } catch (err) {
    console.error("[customers:persistence]", err.message);
  }
  if (!ADMIN_TOKEN) {
    console.log("تنبيه: ضع ADMIN_TOKEN في ملف .env لتفعيل لوحة التحكم");
  } else {
    console.log(`Admin token length: ${ADMIN_TOKEN.length} (جاهز)`);
    console.log(`رمز دخول اللوحة: ${ADMIN_TOKEN}`);
  }
});
