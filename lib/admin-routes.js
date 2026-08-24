/**
 * واجهة برمجة لوحة التحكم الخارجية
 */
const path = require("path");
const express = require("express");
const CONFIG = require("../config");
const { createCampaignAudience } = require("./campaign-audience");
const {
  looksLikeFollowupMessage,
  looksLikePlusMessage,
  hasFirstFollowup,
} = require("./customer-outcome");

function normalizePhoneParts(input = {}) {
  let phone = String(input.phone || input.phoneNumber || "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
  let countryCode = String(input.countryCode || "+966").trim();
  if (!countryCode.startsWith("+")) countryCode = `+${countryCode}`;
  if (phone.startsWith("966") && phone.length > 9) {
    phone = phone.slice(3);
  }
  return { phone, countryCode };
}

function createAdminRouter(deps) {
  const {
    adminToken: adminTokenInput,
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
    sendInteraktTemplate,
    sendResultReply,
    showMainMenu,
    interaktConfigured,
    customerLedger,
    interaktApiKey,
  } = deps || {};

  const adminToken =
    String(adminTokenInput || "")
      .replace(/^\uFEFF/, "")
      .replace(/[\r\n]/g, "")
      .trim()
      .replace(/^['"]|['"]$/g, "") || "123456";

  const router = express.Router();
  const activityLog = [];
  /** عداد المتابعة الجماعية اليومي (Asia/Riyadh) — يُصفّر بعد إعادة التشغيل */
  const bulkFollowupDaily = { dayKey: "", count: 0 };
  const bulkJob = {
    running: false,
    via: null,
    queued: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    skipped: 0,
    results: [],
    startedAt: null,
    finishedAt: null,
    error: null,
    lastError: null,
    lastPhone: null,
    hint: null,
  };
  const campaignAudience = createCampaignAudience({
    dataFile: customerLedger?._dataFile
      ? path.join(path.dirname(customerLedger._dataFile), "campaign-audience.json")
      : path.join(__dirname, "..", "data", "campaign-audience.json"),
  });

  function snapshotBulkJob() {
    return {
      ...bulkJob,
      results: Array.isArray(bulkJob.results) ? bulkJob.results.slice(-80) : [],
    };
  }

  function inWhatsappWindow(row, hours = 24) {
    const at = Date.parse(row?.lastInboundAt || row?.lastSeenAt || 0);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at <= hours * 60 * 60 * 1000;
  }

  function riyadhDayKey(d = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }

  function getBulkFollowupSafeConfig() {
    const cfg = CONFIG.outbound || {};
    const minDelayMs = Math.max(
      Number(cfg.minDelayMs != null ? cfg.minDelayMs : 8000),
      0
    );
    const delayMs = Math.max(
      Number(cfg.delayMs != null ? cfg.delayMs : 10000),
      minDelayMs
    );
    const maxBatchSize = Math.min(
      Math.max(Number(cfg.maxBatchSize || 30), 1),
      250
    );
    const dailyLimit = Math.min(
      Math.max(Number(cfg.dailyLimit || 80), 1),
      250
    );
    const skipIfFollowedUpWithinHours = Math.max(
      Number(
        cfg.skipIfFollowedUpWithinHours != null
          ? cfg.skipIfFollowedUpWithinHours
          : 20
      ),
      0
    );
    return {
      minDelayMs,
      delayMs,
      maxBatchSize,
      dailyLimit,
      skipIfFollowedUpWithinHours,
    };
  }

  function getBulkDailyUsage() {
    const dayKey = riyadhDayKey();
    if (bulkFollowupDaily.dayKey !== dayKey) {
      bulkFollowupDaily.dayKey = dayKey;
      bulkFollowupDaily.count = 0;
    }
    return bulkFollowupDaily;
  }

  function pushLog(entry) {
    activityLog.unshift({
      ...entry,
      at: new Date().toISOString(),
    });
    if (activityLog.length > 100) activityLog.length = 100;
  }

  function normalizeToken(value) {
    return String(value || "")
      .replace(/^\uFEFF/, "")
      .replace(/[\r\n]/g, "")
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }

  function cookieToken(req) {
    const raw = req.get("cookie") || "";
    const parts = raw.split(";").map((p) => p.trim());
    for (const part of parts) {
      if (part.startsWith("raed_admin_token=")) {
        try {
          return decodeURIComponent(part.slice("raed_admin_token=".length));
        } catch {
          return part.slice("raed_admin_token=".length);
        }
      }
    }
    return "";
  }

  function setAdminCookie(res, token) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `raed_admin_token=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly${secure}`
    );
  }

  function clearAdminCookie(res) {
    res.setHeader(
      "Set-Cookie",
      "raed_admin_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly"
    );
  }

  function requireAdmin(_req, _res, next) {
    // اللوحة شخصية وبدون شاشة دخول — لا نوقف الـ API بسبب الرمز
    return next();
  }

  /** دخول يضبط كوكي HttpOnly عشان ما يضيع بعد تحديث الجوال */
  router.post("/login", (req, res) => {
    const token = normalizeToken(adminToken);
    if (!token) {
      return res.status(503).json({ ok: false, error: "ADMIN_TOKEN غير مضبوط" });
    }
    const got = normalizeToken(req.body?.token || req.get("x-admin-token") || "");
    if (got !== token) {
      return res.status(401).json({ ok: false, error: "الرمز غير صحيح" });
    }
    setAdminCookie(res, token);
    const persistence = customerLedger?.persistenceInfo?.() || null;
    const summary = customerLedger?.summary?.() || null;
    return res.json({
      ok: true,
      counts: summary?.counts || null,
      persistence,
    });
  });

  router.post("/logout", (_req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  function listConversations() {
    const keys = new Set([
      ...sessions.keys(),
      ...drafts.keys(),
      ...pausedChats,
    ]);
    const rows = [];
    for (const key of keys) {
      const [countryCode, phone] = key.split(":");
      const sessionRow = sessions.get(key);
      const draftRow = drafts.get(key);
      rows.push({
        key,
        countryCode,
        phone,
        paused: pausedChats.has(key),
        session: sessionRow
          ? {
              savedAt: sessionRow.savedAt,
              maxAmount: sessionRow.data?.maxAmount || sessionRow.data?.rounded,
              offer: sessionRow.data?.offer || null,
              awaitingCombo: Boolean(sessionRow.data?.awaitingCombo),
              awaitingDebtContinue: Boolean(
                sessionRow.data?.awaitingDebtContinue
              ),
              awaitingAmountChoice: Boolean(
                sessionRow.data?.awaitingAmountChoice
              ),
            }
          : null,
        draft: draftRow
          ? {
              savedAt: draftRow.savedAt,
              flow: draftRow.data?.flow || null,
              step: draftRow.data?.step || null,
              jobCategory: draftRow.data?.jobCategory || null,
            }
          : null,
      });
    }
    rows.sort((a, b) => {
      const ta = Math.max(a.session?.savedAt || 0, a.draft?.savedAt || 0);
      const tb = Math.max(b.session?.savedAt || 0, b.draft?.savedAt || 0);
      return tb - ta;
    });
    return rows;
  }

  function enrichCustomer(row, { includeEvents = false } = {}) {
    const key = sessionKey(row.countryCode, row.phone);
    const sessionRow = sessions.get(key);
    const draftRow = drafts.get(key);
    const liveCompany =
      draftRow?.data?.companyName || sessionRow?.data?.companyName || null;
    const liveJob =
      draftRow?.data?.jobCategory || sessionRow?.data?.jobCategory || null;
    const liveSubtype =
      draftRow?.data?.civilianSubtype ||
      sessionRow?.data?.civilianSubtype ||
      null;
    const out = {
      key: row.key,
      phone: row.phone,
      countryCode: row.countryCode,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      lastInboundAt: row.lastInboundAt || null,
      lastOutboundAt: row.lastOutboundAt || null,
      lastInboundText: row.lastInboundText || "",
      lastOutboundPreview: row.lastOutboundPreview || "",
      inboundCount: row.inboundCount || 0,
      outboundCount: row.outboundCount || 0,
      flow: row.flow || null,
      step: row.step || null,
      maxAmount: row.maxAmount ?? null,
      companyName: row.companyName || liveCompany || null,
      jobCategory: row.jobCategory || liveJob || null,
      civilianSubtype: row.civilianSubtype || liveSubtype || null,
      outcome: row.outcome || "",
      notes: row.notes || "",
      archived: Boolean(row.archived),
      archivedAt: row.archivedAt || null,
      followupSent: Boolean(row.followupSent) || hasFirstFollowup(row),
      followupSentAt: row.followupSentAt || null,
      followupPlus: Boolean(row.followupPlus),
      followupPlusAt: row.followupPlusAt || null,
      manual: Boolean(row.manual),
      manualAt: row.manualAt || null,
      rejected: Boolean(row.rejected),
      rejectedAt: row.rejectedAt || null,
      orderNumber:
        row.orderNumber ||
        sessionRow?.data?.orderNumber ||
        null,
      orderNumberAt:
        row.orderNumberAt || sessionRow?.data?.orderNumberAt || null,
      source: row.source || null,
      syncedAt: row.syncedAt || null,
      dayKey: row.dayKey || null,
      paused: pausedChats.has(key),
      live: {
        session: sessionRow
          ? {
              savedAt: sessionRow.savedAt,
              maxAmount:
                sessionRow.data?.maxAmount || sessionRow.data?.rounded || null,
              offer: sessionRow.data?.offer || null,
            }
          : null,
        draft: draftRow
          ? {
              savedAt: draftRow.savedAt,
              flow: draftRow.data?.flow || null,
              step: draftRow.data?.step || null,
            }
          : null,
      },
    };
    if (includeEvents) {
      out.events = Array.isArray(row.events) ? row.events : [];
    }
    return out;
  }

  function financeWindowCounts() {
    if (!customerLedger?.listByDay) {
      return {
        financeLinkTotal: 0,
        financeLinkPending: 0,
        financeLinkPlus: 0,
        financeLinkPlusEligible: 0,
        financeLinkPendingInWindow: 0,
        financeLinkPendingOutsideWindow: 0,
      };
    }
    const pending = customerLedger.listByDay("finance_link_pending").customers || [];
    const sent = customerLedger.listByDay("finance_link_sent").customers || [];
    const plus = customerLedger.listByDay("finance_link_plus").customers || [];
    const allLink = customerLedger.listByDay("finance_link").customers || [];
    const inWin = pending.filter((r) => inWhatsappWindow(r)).length;
    return {
      financeLinkTotal: allLink.length,
      financeLinkPending: pending.length,
      financeLinkPlus: plus.length,
      financeLinkPlusEligible: sent.length,
      financeLinkPendingInWindow: inWin,
      financeLinkPendingOutsideWindow: Math.max(pending.length - inWin, 0),
    };
  }

  router.get("/status", requireAdmin, (_req, res) => {
    const ledgerSummary = customerLedger?.summary?.() || null;
    const persistence = customerLedger?.persistenceInfo?.() || null;
    res.json({
      ok: true,
      service: "finance-calc-server",
      interaktConfigured: Boolean(interaktConfigured),
      counts: {
        sessions: sessions.size,
        drafts: drafts.size,
        paused: pausedChats.size,
        conversations: listConversations().length,
        customersToday: ledgerSummary?.counts?.today || 0,
        customersYesterday: ledgerSummary?.counts?.yesterday || 0,
        customersAll: ledgerSummary?.counts?.all || 0,
        customersArchive: ledgerSummary?.counts?.archive || 0,
        customersOrderNumber: ledgerSummary?.counts?.order_number || 0,
        customersPackage: ledgerSummary?.counts?.package || 0,
        customersLimitExhausted: ledgerSummary?.counts?.limit_exhausted || 0,
        customersServiceStop: ledgerSummary?.counts?.service_stop || 0,
        customersFinanceLink: ledgerSummary?.counts?.finance_link || 0,
        customersFinanceLinkPending:
          ledgerSummary?.counts?.finance_link_pending || 0,
        customersFinanceLinkSent: ledgerSummary?.counts?.finance_link_sent || 0,
        customersFinanceLinkPlus: ledgerSummary?.counts?.finance_link_plus || 0,
        customersFinancingSolutions:
          ledgerSummary?.counts?.financing_solutions || 0,
        customersManual: ledgerSummary?.counts?.manual || 0,
        customersRejected: ledgerSummary?.counts?.rejected || 0,
      },
      customers: ledgerSummary,
      persistence,
      brand: CONFIG.brand?.name || "عبدالرحمن الرشيدي",
      followUpPreview: CONFIG.followUp?.electronicMessage || "",
      followUpPlusPreview: CONFIG.followUp?.plusMessage || "",
      followUpTemplate: {
        name: CONFIG.followUp?.templateName || "",
        language: CONFIG.followUp?.templateLanguage || "ar",
      },
      bulkJob: snapshotBulkJob(),
      outboundDelayMs: getBulkFollowupSafeConfig().delayMs,
      outboundSafe: (() => {
        const safe = getBulkFollowupSafeConfig();
        const usage = getBulkDailyUsage();
        return {
          ...safe,
          dailySent: usage.count,
          dailyRemaining: Math.max(safe.dailyLimit - usage.count, 0),
          ...financeWindowCounts(),
        };
      })(),
    });
  });

  router.get("/conversations", requireAdmin, (_req, res) => {
    res.json({ ok: true, conversations: listConversations() });
  });

  /**
   * عملاء اليوم / أمس / الكل / حسب «وش صار» / الأرشيف
   * ?day=today|yesterday|all|archive|finance_link|order_number|package|limit_exhausted|service_stop|YYYY-MM-DD
   * ?limit=&offset= للصفحات (افتراضي 100) — يقلل ثقل الجوال
   * ?phonesOnly=1 لنسخ الأرقام فقط
   */
  router.get("/customers", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({
        ok: false,
        error: "سجل العملاء غير مفعّل على هذا السيرفر",
      });
    }
    const day = String(req.query.day || "today").trim() || "today";
    const pack = customerLedger.listByDay(day);
    const summary = customerLedger.summary();
    const phonesOnly =
      req.query.phonesOnly === "1" || req.query.phonesOnly === "true";
    if (phonesOnly) {
      return res.json({
        ok: true,
        timezone: pack.timezone,
        today: pack.today,
        yesterday: pack.yesterday,
        day: pack.day,
        count: pack.count,
        counts: summary.counts,
        phones: pack.customers.map((row) => ({
          phone: row.phone,
          countryCode: row.countryCode,
        })),
      });
    }

    const total = pack.customers.length;
    const wantAll =
      req.query.limit === "all" ||
      req.query.limit === "0" ||
      req.query.all === "1";
    const limit = wantAll
      ? total
      : Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const slice = pack.customers.slice(offset, offset + limit);
    const enriched = slice.map((row) => enrichCustomer(row));
    res.json({
      ok: true,
      timezone: pack.timezone,
      today: pack.today,
      yesterday: pack.yesterday,
      day: pack.day,
      count: total,
      offset,
      limit: wantAll ? total : limit,
      hasMore: offset + enriched.length < total,
      counts: summary.counts,
      customers: enriched,
      persistence: customerLedger.persistenceInfo?.() || null,
    });
  });

  router.get("/customers/lookup", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts({
      phone: req.query.phone,
      countryCode: req.query.countryCode,
    });
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const row =
      customerLedger.getByPhone?.(phone) ||
      customerLedger.getOrCreate?.(countryCode, phone);
    if (!row) {
      return res.status(404).json({ ok: false, error: "ما لقينا العميل" });
    }
    res.json({
      ok: true,
      customer: enrichCustomer(row, { includeEvents: true }),
    });
  });

  router.get("/customers/search", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const q = String(req.query.phone || req.query.q || "").trim();
    const rows = customerLedger.searchByPhone?.(q, 20) || [];
    res.json({
      ok: true,
      count: rows.length,
      customers: rows.map((row) => enrichCustomer(row)),
    });
  });

  router.get("/activity", requireAdmin, (_req, res) => {
    res.json({ ok: true, activity: activityLog });
  });

  /** تنزيل بكب JSON لسجل العملاء */
  router.get("/customers/export", requireAdmin, (_req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const payload = customerLedger.exportPayload();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="customers-backup-${stamp}.json"`
    );
    pushLog({ action: "customers-export", count: payload.count });
    res.send(JSON.stringify(payload, null, 2));
  });

  /** استيراد بكب JSON (دمج مع الحالي) */
  router.post("/customers/import", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const payload = req.body?.customers ? req.body : req.body?.payload || req.body;
    const result = customerLedger.importPayload(payload, {
      merge: req.body?.merge !== false,
    });
    if (!result.ok) return res.status(400).json(result);
    pushLog({
      action: "customers-import",
      imported: result.imported,
      updated: result.updated,
    });
    res.json(result);
  });

  /** إنشاء نسخة احتياطية محلية الآن */
  router.post("/customers/backup", requireAdmin, (_req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    customerLedger.flush();
    const snap = customerLedger.createSnapshot("manual");
    pushLog({ action: "customers-backup", count: snap.count || 0 });
    res.json({
      ok: Boolean(snap.ok),
      snapshot: snap,
      backups: customerLedger.listBackups().slice(0, 10),
      summary: customerLedger.summary(),
    });
  });

  router.get("/customers/backups", requireAdmin, (_req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    res.json({ ok: true, backups: customerLedger.listBackups() });
  });

  /** تحديث رقم الطلب يدويًا من اللوحة */
  router.post("/customers/order-number", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const raw = String(req.body?.orderNumber ?? "").replace(/\D/g, "");
    if (raw && !/^101\d{5}$/.test(raw)) {
      return res.status(400).json({
        ok: false,
        error: "رقم الطلب يجب أن يكون 8 أرقام ويبدأ بـ 101",
      });
    }
    const row = customerLedger.setOrderNumber(countryCode, phone, raw || "");
    if (!row) {
      return res.status(400).json({ ok: false, error: "تعذر حفظ رقم الطلب" });
    }
    customerLedger.flush();
    pushLog({
      action: "customers-order-number",
      phone,
      countryCode,
      orderNumber: row.orderNumber,
    });
    res.json({
      ok: true,
      phone,
      countryCode,
      orderNumber: row.orderNumber,
      orderNumberAt: row.orderNumberAt,
    });
  });

  /** أرشفة / إلغاء أرشفة عميل */
  router.post("/customers/archive", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const archived =
      req.body?.archived === false ||
      req.body?.archived === "false" ||
      req.body?.archived === 0 ||
      req.body?.unarchive === true
        ? false
        : true;
    const row = customerLedger.setArchived(countryCode, phone, archived);
    if (!row) {
      return res.status(400).json({ ok: false, error: "تعذر تحديث الأرشيف" });
    }
    customerLedger.flush();
    pushLog({
      action: archived ? "customers-archive" : "customers-unarchive",
      phone,
      countryCode,
    });
    res.json({
      ok: true,
      phone,
      countryCode,
      archived: Boolean(row.archived),
      archivedAt: row.archivedAt || null,
    });
  });

  /** تحديث خانة «وش صار» */
  router.post("/customers/outcome", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const outcome = String(req.body?.outcome ?? req.body?.note ?? "");
    const row = customerLedger.setOutcomeNotes(countryCode, phone, outcome);
    if (!row) {
      return res.status(400).json({ ok: false, error: "تعذر حفظ الحالة" });
    }
    customerLedger.flush();
    pushLog({ action: "customers-outcome", phone, countryCode, outcome: row.outcome });
    res.json({ ok: true, phone, countryCode, outcome: row.outcome || "" });
  });

  /** تحديث ملاحظة حرة للعميل */
  router.post("/customers/notes", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const notes = String(req.body?.notes ?? "");
    const row = customerLedger.setNotes(countryCode, phone, notes);
    if (!row) {
      return res.status(400).json({ ok: false, error: "تعذر حفظ الملاحظة" });
    }
    customerLedger.flush();
    pushLog({ action: "customers-notes", phone, countryCode });
    res.json({
      ok: true,
      phone,
      countryCode,
      notes: row.notes,
      outcome: row.outcome || "",
    });
  });

  /** تحديث جهة العمل من اللوحة: government | private | military | clear */
  router.post("/customers/workplace", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const workplace = String(req.body?.workplace ?? req.body?.choice ?? "").trim();
    const result = customerLedger.setWorkplace(countryCode, phone, workplace);
    if (!result || result.ok === false) {
      return res.status(400).json({
        ok: false,
        error: result?.error || "تعذر حفظ جهة العمل",
      });
    }
    customerLedger.flush();
    pushLog({
      action: "customers-workplace",
      phone,
      countryCode,
      workplace: workplace || "clear",
    });
    res.json({
      ok: true,
      phone,
      countryCode,
      jobCategory: result.row.jobCategory,
      civilianSubtype: result.row.civilianSubtype,
      companyName: result.row.companyName || null,
    });
  });

  router.post("/customers/manual", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const manual =
      req.body?.manual === false ||
      req.body?.manual === "false" ||
      req.body?.manual === 0
        ? false
        : true;
    const row = customerLedger.setManual(countryCode, phone, manual);
    if (!row) {
      return res.status(400).json({ ok: false, error: "تعذر تحديث القسم اليدوي" });
    }
    customerLedger.flush();
    pushLog({ action: manual ? "customers-manual" : "customers-unmanual", phone });
    res.json({
      ok: true,
      phone,
      countryCode,
      manual: Boolean(row.manual),
      customer: enrichCustomer(row),
    });
  });

  router.post("/customers/rejected", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const rejected =
      req.body?.rejected === false ||
      req.body?.rejected === "false" ||
      req.body?.rejected === 0
        ? false
        : true;
    const row = customerLedger.setRejected(countryCode, phone, rejected);
    if (!row) {
      return res.status(400).json({ ok: false, error: "تعذر تحديث قسم الرفض" });
    }
    customerLedger.flush();
    pushLog({
      action: rejected ? "customers-rejected" : "customers-unreject",
      phone,
    });
    res.json({
      ok: true,
      phone,
      countryCode,
      rejected: Boolean(row.rejected),
      customer: enrichCustomer(row),
    });
  });

  router.post("/customers/followup-plus", requireAdmin, (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) {
      return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    }
    const plus =
      req.body?.plus === false ||
      req.body?.plus === "false" ||
      req.body?.plus === 0
        ? false
        : true;
    const row = customerLedger.setFollowupPlus(countryCode, phone, plus);
    if (!row) {
      return res.status(400).json({ ok: false, error: "تعذر تحديث متابعة بلس" });
    }
    customerLedger.flush();
    pushLog({
      action: plus ? "customers-followup-plus" : "customers-unplus",
      phone,
    });
    res.json({
      ok: true,
      phone,
      countryCode,
      followupPlus: Boolean(row.followupPlus),
      customer: enrichCustomer(row),
    });
  });

  /**
   * جلب العملاء السابقين من Interakt (آخر N أيام)
   * يعتمد Get Users API — أرقام + تواريخ، مو نصوص الشات كاملة
   */
  router.post("/customers/sync-interakt", requireAdmin, async (req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const apiKey = interaktApiKey || process.env.INTERAKT_API_KEY || "";
    if (!apiKey) {
      return res.status(503).json({
        ok: false,
        error: "INTERAKT_API_KEY غير مضبوط — لا يمكن جلب السابق من Interakt",
      });
    }
    try {
      const { syncInteraktUsersSince } = require("./interakt-users");
      const days = Math.min(Math.max(Number(req.body?.days || 7), 1), 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      customerLedger.createSnapshot("pre-sync");
      const result = await syncInteraktUsersSince({
        apiKey,
        sinceIso: since,
        onUser: (contact) =>
          customerLedger.upsertContact({
            ...contact,
            // عشان يظهرون فورًا في تبويب اليوم بعد الجلب
            touchNow: true,
            source: "interakt",
          }),
      });
      const saved = customerLedger.flush();
      const persistence = customerLedger.persistenceInfo();
      pushLog({
        action: "customers-sync-interakt",
        fetched: result.fetched,
        created: result.created,
        savedOk: Boolean(saved?.ok),
        durable: Boolean(persistence?.durable),
      });
      res.json({
        ...result,
        days,
        since,
        summary: customerLedger.summary(),
        persistence,
        saved,
        // touchNow يختمهم بتاريخ اليوم فيظهرون في تبويب اليوم
        preferDay: result.fetched > 0 ? "today" : "all",
        hint: persistence?.durable
          ? null
          : "تم الجلب في الذاكرة والملف المحلي — لكن بدون Persistent Disk على Render يختفي السجل بعد إعادة التشغيل أو النشر. أضف Disk على /var/data واضبط CUSTOMERS_DATA_DIR=/var/data/kobri",
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
        details: err.details || null,
      });
    }
  });

  router.post("/pause", requireAdmin, (req, res) => {
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    pauseChat(countryCode, phone);
    pushLog({ action: "pause", phone, countryCode });
    res.json({ ok: true, paused: true, phone, countryCode });
  });

  router.post("/resume", requireAdmin, (req, res) => {
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    resumeChat(countryCode, phone);
    pushLog({ action: "resume", phone, countryCode });
    res.json({ ok: true, paused: false, phone, countryCode });
  });

  router.post("/reset", requireAdmin, (req, res) => {
    const { phone, countryCode } = normalizePhoneParts(req.body || {});
    if (!phone) return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    clearDraft(countryCode, phone);
    clearSession(countryCode, phone);
    resumeChat(countryCode, phone);
    pushLog({ action: "reset", phone, countryCode });
    res.json({ ok: true, reset: true, phone, countryCode });
  });

  router.post("/send-text", requireAdmin, async (req, res) => {
    try {
      const { phone, countryCode } = normalizePhoneParts(req.body || {});
      const message = String(req.body?.message || "").trim();
      if (!phone) return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
      if (!message) return res.status(400).json({ ok: false, error: "نص الرسالة مطلوب" });
      await sendInteraktText(countryCode, phone, message);
      customerLedger?.recordOutbound?.(countryCode, phone, message, {
        mode: "admin-text",
      });
      pushLog({
        action: "send-text",
        phone,
        countryCode,
        preview: message.slice(0, 80),
      });
      res.json({ ok: true, sent: true, phone, countryCode });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
        details: err.details || null,
      });
    }
  });

  router.post("/send-followup", requireAdmin, async (req, res) => {
    try {
      const { phone, countryCode } = normalizePhoneParts(req.body || {});
      if (!phone) return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
      const kind = String(req.body?.kind || req.body?.type || "").trim().toLowerCase();
      const isPlus = kind === "ask-plus" || kind === "plus";
      const message =
        String(req.body?.message || "").trim() ||
        (isPlus
          ? CONFIG.followUp?.plusMessage
          : CONFIG.followUp?.electronicMessage) ||
        (isPlus
          ? `السلام عليكم
نأسف لعدم تقديمكم للطلب`
          : `السلام عليكم
هل تم تقديم الطلب
في حال تم التقديم ارسل رقم الطلب`);
      await sendInteraktText(countryCode, phone, message);
      customerLedger?.recordOutbound?.(countryCode, phone, message, {
        mode: isPlus ? "admin-followup-plus" : "admin-followup",
      });
      if (isPlus) {
        customerLedger?.setFollowupPlus?.(countryCode, phone, true);
      } else {
        customerLedger?.setFollowupSent?.(countryCode, phone, true);
      }
      customerLedger?.flush?.();
      pushLog({
        action: isPlus ? "send-followup-plus" : "send-followup",
        phone,
        countryCode,
        preview: message.slice(0, 80),
      });
      res.json({ ok: true, sent: true, phone, countryCode, kind: isPlus ? "ask-plus" : "ask-order" });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
        details: err.details || null,
      });
    }
  });

  router.post("/send-menu", requireAdmin, async (req, res) => {
    try {
      const { phone, countryCode } = normalizePhoneParts(req.body || {});
      if (!phone) return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
      const result = showMainMenu("قائمة");
      resumeChat(countryCode, phone);
      clearDraft(countryCode, phone);
      clearSession(countryCode, phone);
      if (result.draft) saveDraft(countryCode, phone, result.draft);
      await sendResultReply(countryCode, phone, result);
      customerLedger?.recordOutbound?.(
        countryCode,
        phone,
        result.reply || "القائمة الرئيسية",
        { mode: "admin-menu", flow: "main_menu", step: "awaiting_choice" }
      );
      pushLog({ action: "send-menu", phone, countryCode });
      res.json({ ok: true, sent: true, phone, countryCode });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
        details: err.details || null,
      });
    }
  });

  function listFollowupCandidates(fromOutcome) {
    if (!customerLedger?.listByDay) return [];
    const key = String(fromOutcome || "").trim().toLowerCase();
    if (key === "finance_link_plus") {
      return customerLedger.listByDay("finance_link_sent").customers || [];
    }
    if (key === "finance_link_plus_list") {
      return customerLedger.listByDay("finance_link_plus").customers || [];
    }
    if (key === "finance_link" || key === "أخذ رابط التمويل") {
      return customerLedger.listByDay("finance_link_pending").customers || [];
    }
    return [];
  }

  function parseTemplateBodyValues(raw) {
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v).trim()).filter(Boolean);
    }
    const s = String(raw || "").trim();
    if (!s) return [];
    return s.split(/[,،]/).map((v) => v.trim()).filter(Boolean);
  }

  function markFollowupAfterSend(fromOutcome, countryCode, phone) {
    const key = String(fromOutcome || "").trim().toLowerCase();
    if (key === "finance_link_plus" || key === "finance_link_plus_list") {
      customerLedger?.setFollowupPlus?.(countryCode, phone, true);
      return;
    }
    customerLedger?.setFollowupSent?.(countryCode, phone, true);
  }

  router.post("/bulk-followup", requireAdmin, async (req, res) => {
    const safe = getBulkFollowupSafeConfig();
    const usage = getBulkDailyUsage();
    const fromOutcome = String(req.body?.fromOutcome || req.body?.outcome || "")
      .trim()
      .toLowerCase();
    const via = String(req.body?.via || "").trim().toLowerCase();
    const useTemplate = via === "interakt" || via === "template";
    const isPlus =
      fromOutcome === "finance_link_plus" ||
      fromOutcome === "finance_link_plus_list";
    const templateName = String(req.body?.templateName || "").trim();
    const bodyValues = parseTemplateBodyValues(req.body?.bodyValues);
    const message =
      String(req.body?.message || "").trim() ||
      (isPlus
        ? CONFIG.followUp?.plusMessage
        : CONFIG.followUp?.electronicMessage) ||
      "";
    let delayMs = Number(
      req.body?.delayMs != null ? req.body.delayMs : safe.delayMs
    );
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      delayMs = Math.max(safe.delayMs, safe.minDelayMs);
    }
    if (delayMs > 0 && delayMs < safe.minDelayMs) {
      delayMs = Math.max(safe.delayMs, safe.minDelayMs);
    }
    const requestedLimit = Number(
      req.body?.limit != null ? req.body.limit : safe.maxBatchSize
    );
    const batchLimit = Math.min(
      Math.max(Number.isFinite(requestedLimit) ? requestedLimit : safe.maxBatchSize, 1),
      safe.maxBatchSize
    );

    if (useTemplate && !templateName) {
      return res.status(400).json({
        ok: false,
        error: "كود قالب إنترأكت مطلوب للإرسال خارج نافذة 24 ساعة",
      });
    }
    if (!useTemplate && !message) {
      return res.status(400).json({ ok: false, error: "نص المتابعة فارغ" });
    }
    if (bulkJob.running) {
      return res.status(409).json({
        ok: false,
        error: "جاري إرسال متابعة حالياً — انتظر حتى ينتهي",
        bulkJob: snapshotBulkJob(),
      });
    }

    const dailyRemaining = Math.max(safe.dailyLimit - usage.count, 0);
    if (dailyRemaining <= 0) {
      return res.status(429).json({
        ok: false,
        error: `تم بلوغ الحد اليومي للمتابعة الجماعية (${safe.dailyLimit}). كمّل غدًا.`,
        dailyLimit: safe.dailyLimit,
        dailySent: usage.count,
      });
    }

    let candidates = listFollowupCandidates(fromOutcome);
    if (!candidates.length && !fromOutcome) {
      const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
      candidates = phones.map((p) => {
        if (p && typeof p === "object") {
          return {
            phone: p.phone,
            countryCode: p.countryCode,
            lastOutboundAt: p.lastOutboundAt || null,
            lastOutboundPreview: p.lastOutboundPreview || "",
            lastInboundAt: p.lastInboundAt || null,
            lastSeenAt: p.lastSeenAt || null,
          };
        }
        return { phone: p, countryCode: req.body?.countryCode };
      });
    }

    if (!candidates.length) {
      return res.status(400).json({
        ok: false,
        error: isPlus
          ? "لا يوجد عملاء لمتابعة بلس"
          : "لا يوجد عملاء بدون متابعة (تأكد من تبويب رابط — بدون متابعة)",
      });
    }

    const skipMs = safe.skipIfFollowedUpWithinHours * 60 * 60 * 1000;
    const now = Date.now();
    const skipped = [];
    const queue = [];
    for (const raw of candidates) {
      const parts = normalizePhoneParts(raw);
      if (!parts.phone) {
        skipped.push({ phone: String(raw.phone || ""), reason: "رقم غير صالح" });
        continue;
      }
      const inside = inWhatsappWindow(raw);
      if (useTemplate && inside) {
        skipped.push({ phone: parts.phone, reason: "داخل نافذة 24 ساعة — أرسل رسالة عادية" });
        continue;
      }
      if (!useTemplate && !inside) {
        skipped.push({ phone: parts.phone, reason: "خارج نافذة 24 ساعة — يلزم قالب إنترأكت" });
        continue;
      }
      if (skipMs > 0 && raw.lastOutboundAt) {
        const lastAt = Date.parse(raw.lastOutboundAt);
        const preview = raw.lastOutboundPreview || "";
        const recentFollow =
          (isPlus && (looksLikePlusMessage(preview) || Boolean(raw.followupPlus))) ||
          (!isPlus && looksLikeFollowupMessage(preview));
        if (Number.isFinite(lastAt) && now - lastAt < skipMs && recentFollow) {
          skipped.push({
            phone: parts.phone,
            reason: `تمت المتابعة خلال ${safe.skipIfFollowedUpWithinHours} ساعة`,
          });
          continue;
        }
      }
      queue.push({ ...parts, row: raw });
    }

    const sendCap = Math.min(batchLimit, dailyRemaining, queue.length);
    const toSend = queue.slice(0, sendCap);
    const deferred = queue.slice(sendCap);

    if (!toSend.length) {
      return res.status(400).json({
        ok: false,
        error: useTemplate
          ? "ما فيه أحد خارج نافذة 24 ساعة لهذا الإرسال"
          : "ما فيه أحد داخل نافذة 24 ساعة لهذا الإرسال",
        skipped: skipped.length,
        skippedDetails: skipped.slice(0, 40),
      });
    }

    async function sendOne(parts) {
      if (useTemplate) {
        if (typeof sendInteraktTemplate !== "function") {
          throw new Error("إرسال قوالب إنترأكت غير مفعّل على هذا السيرفر");
        }
        await sendInteraktTemplate(parts.countryCode, parts.phone, {
          name: templateName,
          languageCode: CONFIG.followUp?.templateLanguage || "ar",
          bodyValues,
        });
        const preview = message || `[قالب إنترأكت: ${templateName}]`;
        customerLedger?.recordOutbound?.(
          parts.countryCode,
          parts.phone,
          preview,
          { mode: "admin-bulk-template" }
        );
      } else {
        await sendInteraktText(parts.countryCode, parts.phone, message);
        customerLedger?.recordOutbound?.(
          parts.countryCode,
          parts.phone,
          message,
          { mode: "admin-bulk-followup" }
        );
      }
      markFollowupAfterSend(fromOutcome, parts.countryCode, parts.phone);
    }

    async function runQueue() {
      bulkJob.running = true;
      bulkJob.via = useTemplate ? "interakt" : "session";
      bulkJob.queued = toSend.length;
      bulkJob.sent = 0;
      bulkJob.failed = 0;
      bulkJob.deferred = deferred.length;
      bulkJob.skipped = skipped.length;
      bulkJob.results = [];
      bulkJob.startedAt = new Date().toISOString();
      bulkJob.finishedAt = null;
      bulkJob.error = null;
      bulkJob.lastError = null;
      bulkJob.lastPhone = null;
      bulkJob.hint =
        deferred.length > 0
          ? `تبقّى ${deferred.length} للإرسال لاحقًا (حد الدفعة/اليوم).`
          : null;
      for (let i = 0; i < toSend.length; i += 1) {
        const parts = toSend[i];
        bulkJob.lastPhone = parts.phone;
        try {
          await sendOne(parts);
          usage.count += 1;
          bulkJob.sent += 1;
          bulkJob.results.push({ phone: parts.phone, ok: true });
          pushLog({
            action: "bulk-followup",
            phone: parts.phone,
            countryCode: parts.countryCode,
            fromOutcome: fromOutcome || null,
            via: bulkJob.via,
          });
        } catch (err) {
          bulkJob.failed += 1;
          bulkJob.lastError = err.message;
          bulkJob.results.push({
            phone: parts.phone,
            ok: false,
            error: err.message,
          });
        }
        if (i < toSend.length - 1 && delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      customerLedger?.flush?.();
      bulkJob.running = false;
      bulkJob.finishedAt = new Date().toISOString();
    }

    if (delayMs === 0) {
      await runQueue();
      const snap = snapshotBulkJob();
      return res.json({
        ok: true,
        started: false,
        sent: snap.sent,
        failed: snap.failed,
        skipped: skipped.length,
        deferred: deferred.length,
        delayMs,
        via: snap.via,
        dailyLimit: safe.dailyLimit,
        dailySent: usage.count,
        dailyRemaining: Math.max(safe.dailyLimit - usage.count, 0),
        results: snap.results,
        skippedDetails: skipped.slice(0, 40),
        bulkJob: snap,
        hint: snap.hint,
      });
    }

    runQueue().catch((err) => {
      bulkJob.running = false;
      bulkJob.error = err.message;
      bulkJob.finishedAt = new Date().toISOString();
    });
    res.json({
      ok: true,
      started: true,
      queued: toSend.length,
      skipped: skipped.length,
      deferred: deferred.length,
      delayMs,
      pollMs: CONFIG.outbound?.pollMs || 2500,
      via: useTemplate ? "interakt" : "session",
      dailyLimit: safe.dailyLimit,
      dailySent: usage.count,
      dailyRemaining: Math.max(safe.dailyLimit - usage.count, 0),
      bulkJob: snapshotBulkJob(),
      skippedDetails: skipped.slice(0, 40),
    });
  });

  function csvForRows(rows, filename) {
    const lines = ["countryCode,phoneNumber"];
    for (const row of rows) {
      const parts = normalizePhoneParts(row);
      if (!parts.phone) continue;
      lines.push(`${parts.countryCode},${parts.phone}`);
    }
    return {
      ok: true,
      csv: `${lines.join("\n")}\n`,
      count: Math.max(lines.length - 1, 0),
      filename,
    };
  }

  router.get("/customers/followup-template-csv", requireAdmin, (_req, res) => {
    if (!customerLedger) {
      return res.status(503).json({ ok: false, error: "سجل العملاء غير مفعّل" });
    }
    const pending = customerLedger.listByDay("finance_link_pending").customers || [];
    const outside = pending.filter((row) => !inWhatsappWindow(row));
    const stamp = new Date().toISOString().slice(0, 10);
    res.json(csvForRows(outside, `followup-outside-24h-${stamp}.csv`));
  });

  router.get("/campaigns/audience", requireAdmin, (_req, res) => {
    res.json({ ok: true, count: campaignAudience.count() });
  });

  router.post("/campaigns/audience-csv", requireAdmin, (req, res) => {
    const phonesRaw = req.body?.phones || req.body?.csv || "";
    const remember = req.body?.remember !== false;
    const pack = campaignAudience.buildCsv(phonesRaw, { remember });
    pushLog({
      action: "campaigns-audience-csv",
      count: pack.count,
      skipped: pack.skipped,
    });
    res.json(pack);
  });

  router.post("/campaigns/import-audience", requireAdmin, (req, res) => {
    const csv = req.body?.csv || req.body?.phones || "";
    const result = campaignAudience.importCsv(csv);
    pushLog({
      action: "campaigns-import-audience",
      added: result.added,
      source: req.body?.source || null,
    });
    res.json({ ok: true, added: result.added, count: result.count });
  });

  // حالة محادثة واحدة
  router.get("/conversation/:phone", requireAdmin, (req, res) => {
    const { phone, countryCode } = normalizePhoneParts({
      phone: req.params.phone,
      countryCode: req.query.countryCode,
    });
    if (!phone) return res.status(400).json({ ok: false, error: "رقم الجوال مطلوب" });
    const key = sessionKey(countryCode, phone);
    res.json({
      ok: true,
      phone,
      countryCode,
      paused: isChatPaused(countryCode, phone),
      session: sessions.get(key) || null,
      draft: drafts.get(key) || null,
    });
  });

  return router;
}

function mountAdmin(app, deps) {
  const router = createAdminRouter(deps);
  const adminDir = path.join(__dirname, "..", "public", "admin");
  const indexFile = path.join(adminDir, "index.html");

  function grantAdminCookie(res) {
    const token =
      String(deps.adminToken || "")
        .replace(/^\uFEFF/, "")
        .replace(/[\r\n]/g, "")
        .trim()
        .replace(/^['"]|['"]$/g, "") || "123456";
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    // فتح /admin يضبط الجلسة مباشرة — بدون شاشة دخول
    res.setHeader(
      "Set-Cookie",
      `raed_admin_token=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly${secure}`
    );
  }

  app.use("/admin/api", router);

  app.get(["/admin", "/admin/", "/admin/index.html"], (_req, res) => {
    grantAdminCookie(res);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.sendFile(indexFile);
  });

  app.use(
    "/admin",
    express.static(adminDir, {
      etag: false,
      lastModified: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          grantAdminCookie(res);
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        }
      },
    })
  );
}

module.exports = {
  createAdminRouter,
  mountAdmin,
  normalizePhoneParts,
};
