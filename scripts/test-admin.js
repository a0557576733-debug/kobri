const assert = require("assert");
const express = require("express");
const os = require("os");
const path = require("path");
const { createAdminRouter, normalizePhoneParts } = require("../lib/admin-routes");
const { showMainMenu } = require("../lib/main-menu");
const { createCustomerLedger } = require("../lib/customer-ledger");

const parts = normalizePhoneParts({ phone: "0501812339" });
assert.strictEqual(parts.phone, "501812339");
assert.strictEqual(parts.countryCode, "+966");

const sessions = new Map();
const drafts = new Map();
const pausedChats = new Set();
function sessionKey(cc, phone) {
  return `${cc}:${phone}`;
}

const customerLedger = createCustomerLedger({
  dataFile: path.join(os.tmpdir(), `admin-ledger-${Date.now()}.json`),
});
customerLedger.recordInbound("+966", "551234567", "مرحبا");

const sent = [];
const app = express();
app.use(express.json());
app.use(
  "/admin/api",
  createAdminRouter({
    adminToken: "test-token",
    sessions,
    drafts,
    pausedChats,
    sessionKey,
    clearDraft: (cc, phone) => drafts.delete(sessionKey(cc, phone)),
    clearSession: (cc, phone) => sessions.delete(sessionKey(cc, phone)),
    pauseChat: (cc, phone) => pausedChats.add(sessionKey(cc, phone)),
    resumeChat: (cc, phone) => pausedChats.delete(sessionKey(cc, phone)),
    isChatPaused: (cc, phone) => pausedChats.has(sessionKey(cc, phone)),
    saveDraft: (cc, phone, data) =>
      drafts.set(sessionKey(cc, phone), { data, savedAt: Date.now() }),
    sendInteraktText: async (cc, phone, message) => {
      sent.push({ cc, phone, message });
      return { ok: true };
    },
    sendResultReply: async (cc, phone, result) => {
      sent.push({ cc, phone, result });
      return "interactive";
    },
    showMainMenu,
    interaktConfigured: true,
    customerLedger,
  })
);

async function req(method, path, body, token = "test-token") {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, json };
  } finally {
    server.close();
  }
}

(async () => {
  const unauthorized = await req("GET", "/status", null, "wrong");
  assert.strictEqual(unauthorized.status, 401);

  const login = await req("POST", "/login", { token: "test-token" });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.json.ok, true);

  const status = await req("GET", "/status");
  assert.strictEqual(status.status, 200);
  assert.strictEqual(status.json.ok, true);
  assert.ok((status.json.counts.customersToday || 0) >= 1);

  const customers = await req("GET", "/customers?day=today");
  assert.strictEqual(customers.status, 200);
  assert.ok(customers.json.count >= 1);
  assert.ok(
    customers.json.customers.some((c) => c.phone === "551234567")
  );

  const paged = await req("GET", "/customers?day=today&limit=1&offset=0");
  assert.strictEqual(paged.status, 200);
  assert.ok(paged.json.count >= 1);
  assert.strictEqual(paged.json.customers.length, 1);
  assert.ok(!("events" in (paged.json.customers[0] || {})));

  const phonesOnly = await req("GET", "/customers?day=today&phonesOnly=1");
  assert.strictEqual(phonesOnly.status, 200);
  assert.ok((phonesOnly.json.phones || []).length >= 1);

  const notes = await req("POST", "/customers/notes", {
    phone: "0551234567",
    notes: "عميل متابع",
  });
  assert.strictEqual(notes.status, 200);
  assert.strictEqual(notes.json.notes, "عميل متابع");
  const outcome = await req("POST", "/customers/outcome", {
    phone: "0551234567",
    outcome: "أخذ باقة",
  });
  assert.strictEqual(outcome.status, 200);
  assert.strictEqual(outcome.json.outcome, "أخذ باقة");
  const afterNotes = await req("GET", "/customers?day=today");
  assert.ok(
    afterNotes.json.customers.some(
      (c) =>
        c.phone === "551234567" &&
        c.notes === "عميل متابع" &&
        c.outcome === "أخذ باقة"
    )
  );

  const archive = await req("POST", "/customers/archive", {
    phone: "0551234567",
    archived: true,
  });
  assert.strictEqual(archive.status, 200);
  assert.strictEqual(archive.json.archived, true);
  const todayAfterArchive = await req("GET", "/customers?day=today");
  assert.ok(
    !todayAfterArchive.json.customers.some((c) => c.phone === "551234567")
  );
  const archiveList = await req("GET", "/customers?day=archive");
  assert.ok(archiveList.json.customers.some((c) => c.phone === "551234567"));
  assert.ok((archiveList.json.counts?.archive || 0) >= 1);
  const unarchive = await req("POST", "/customers/archive", {
    phone: "0551234567",
    archived: false,
  });
  assert.strictEqual(unarchive.json.archived, false);

  const workplace = await req("POST", "/customers/workplace", {
    phone: "0551234567",
    workplace: "government",
  });
  assert.strictEqual(workplace.status, 200);
  assert.strictEqual(workplace.json.jobCategory, "civilian");
  assert.strictEqual(workplace.json.civilianSubtype, "government");
  const privateWp = await req("POST", "/customers/workplace", {
    phone: "0551234567",
    workplace: "private",
  });
  assert.strictEqual(privateWp.json.civilianSubtype, "private");
  const militaryWp = await req("POST", "/customers/workplace", {
    phone: "0551234567",
    workplace: "military",
  });
  assert.strictEqual(militaryWp.json.jobCategory, "military");

  const order = await req("POST", "/customers/order-number", {
    phone: "0551234567",
    orderNumber: "10171234",
  });
  assert.strictEqual(order.status, 200);
  assert.strictEqual(order.json.orderNumber, "10171234");
  const afterOrder = await req("GET", "/customers?day=today");
  assert.ok(
    afterOrder.json.customers.some(
      (c) => c.phone === "551234567" && c.orderNumber === "10171234"
    )
  );

  const exported = await req("GET", "/customers/export");
  assert.strictEqual(exported.status, 200);
  assert.ok((exported.json.customers || []).length >= 1);

  const backup = await req("POST", "/customers/backup", {});
  assert.strictEqual(backup.status, 200);
  assert.ok(backup.json.ok);

  const pause = await req("POST", "/pause", { phone: "0551234567" });
  assert.strictEqual(pause.json.paused, true);
  assert.ok(pausedChats.has("+966:551234567"));

  const send = await req("POST", "/send-text", {
    phone: "0551234567",
    message: "اختبار",
  });
  assert.strictEqual(send.json.sent, true);
  assert.strictEqual(sent[0].message, "اختبار");

  const followup = await req("POST", "/send-followup", { phone: "0551234567" });
  assert.strictEqual(followup.status, 200);
  assert.strictEqual(followup.json.sent, true);
  assert.ok(
    String(sent[sent.length - 1].message).includes("هل تم تقديم الطلب"),
    "رسالة سؤال التقديم"
  );
  assert.ok(
    String(sent[sent.length - 1].message).includes("ارسل رقم الطلب"),
    "طلب رقم الطلب"
  );

  // عميل أخذ رابط التمويل — للمتابعة الجماعية
  customerLedger.recordInbound("+966", "550000001", "تمويل");
  customerLedger.setOutcomeNotes("+966", "550000001", "أخذ رابط التمويل");
  customerLedger.recordInbound("+966", "550000002", "تمويل");
  customerLedger.setOutcomeNotes("+966", "550000002", "أخذ رابط التمويل");
  customerLedger.recordInbound("+966", "550000003", "باقة");
  customerLedger.setOutcomeNotes("+966", "550000003", "أخذ باقة");

  const financeTab = await req("GET", "/customers?day=finance_link");
  assert.strictEqual(financeTab.status, 200);
  assert.ok(
    (financeTab.json.customers || []).some((c) => c.phone === "550000001")
  );
  assert.ok(
    !(financeTab.json.customers || []).some((c) => c.phone === "550000003")
  );
  assert.ok((financeTab.json.counts?.finance_link || 0) >= 2);

  const CONFIG = require("../config");
  const prevOutbound = { ...CONFIG.outbound };
  CONFIG.outbound = {
    ...CONFIG.outbound,
    minDelayMs: 0,
    delayMs: 0,
    maxBatchSize: 2,
    dailyLimit: 3,
    skipIfFollowedUpWithinHours: 0,
  };

  const beforeBulk = sent.length;
  const bulk = await req("POST", "/bulk-followup", {
    fromOutcome: "finance_link",
    delayMs: 0,
    limit: 10,
  });
  assert.strictEqual(bulk.status, 200, bulk.json?.error || "bulk ok");
  assert.strictEqual(bulk.json.sent, 2, "حد الدفعة 2");
  assert.strictEqual(bulk.json.deferred, 0);
  assert.ok(sent.length >= beforeBulk + 2);
  assert.ok(bulk.json.dailySent >= 2);

  const bulk2 = await req("POST", "/bulk-followup", {
    fromOutcome: "finance_link",
    delayMs: 0,
    limit: 10,
  });
  assert.strictEqual(bulk2.status, 200);
  assert.ok(bulk2.json.sent <= 1, "باقي الحصة اليومية");

  const bulk3 = await req("POST", "/bulk-followup", {
    fromOutcome: "finance_link",
    delayMs: 0,
    limit: 10,
  });
  assert.strictEqual(bulk3.status, 429, "حد يومي");
  CONFIG.outbound = prevOutbound;

  const menu = await req("POST", "/send-menu", { phone: "0551234567" });
  assert.strictEqual(menu.json.sent, true);
  assert.ok(drafts.has("+966:551234567"));

  console.log("test-admin: OK");
})().catch((err) => {
  console.error("FAIL:", err);
  process.exitCode = 1;
});
