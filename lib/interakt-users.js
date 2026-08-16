/**
 * جلب جهات اتصال Interakt (Get Users API) لتعبئة سجل العملاء السابق
 * ملاحظة: يجلب الأرقام/تواريخ التواصل — مو نص المحادثات كامل
 */

function normalizeApiKey(apiKey) {
  return String(apiKey || "")
    .replace(/^Basic\s+/i, "")
    .trim();
}

async function fetchInteraktUsersPage({
  apiKey,
  offset = 0,
  limit = 100,
  filters = null,
}) {
  const url = `https://api.interakt.ai/v1/public/apis/users/?offset=${offset}&limit=${limit}`;
  const body =
    filters == null
      ? {}
      : Array.isArray(filters)
        ? { filters }
        : { filters: [] };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${normalizeApiKey(apiKey)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const msg =
      json?.message ||
      json?.error ||
      json?.detail ||
      `Interakt users API ${response.status}`;
    const err = new Error(String(msg));
    err.status = response.status;
    err.details = json;
    throw err;
  }
  return json;
}

function collectArrays(node, out = [], depth = 0) {
  if (!node || depth > 5) return out;
  if (Array.isArray(node)) {
    if (node.length && typeof node[0] === "object") out.push(node);
    for (const item of node) collectArrays(item, out, depth + 1);
    return out;
  }
  if (typeof node === "object") {
    for (const value of Object.values(node)) {
      collectArrays(value, out, depth + 1);
    }
  }
  return out;
}

function looksLikeUser(row) {
  if (!row || typeof row !== "object") return false;
  const traits = row.traits || row.Traits || {};
  const hasPhone = Boolean(
    row.phoneNumber ||
      row.phone_number ||
      row.phone ||
      row.channel_phone_number ||
      row.fullPhoneNumber ||
      row.full_phone_number ||
      traits.phone ||
      traits.phone_number ||
      traits.whatsapp_number ||
      traits.whatsapp ||
      traits.mobile
  );
  if (hasPhone) return true;
  // سجل Interakt غالبًا فيه id + traits/countryCode بدون رقم ظاهر في المستوى الأعلى
  return Boolean(
    (row.userId || row.user_id || row.id) &&
      (row.traits || row.Traits || row.countryCode || row.country_code)
  );
}

function extractUsers(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter(looksLikeUser);
  const direct =
    payload.users ||
    payload.results ||
    payload.customers ||
    payload.contacts ||
    payload.data?.users ||
    payload.data?.results ||
    payload.data?.customers ||
    payload.data?.contacts ||
    (Array.isArray(payload.data) ? payload.data : null);
  if (Array.isArray(direct)) return direct.filter(looksLikeUser);

  const arrays = collectArrays(payload);
  let best = [];
  for (const arr of arrays) {
    const users = arr.filter(looksLikeUser);
    if (users.length > best.length) best = users;
  }
  return best;
}

function hasNextPage(payload, pageLen, limit) {
  if (payload?.has_next_page === true || payload?.hasNextPage === true) {
    return true;
  }
  if (payload?.data?.has_next_page === true) return true;
  if (payload?.pagination?.has_next_page === true) return true;
  return pageLen >= limit;
}

function pickPhone(user = {}) {
  const traits = user.traits || user.Traits || {};
  const candidates = [
    user.phoneNumber,
    user.phone_number,
    user.phone,
    user.channel_phone_number,
    user.trailing_phone,
    user.fullPhoneNumber,
    user.full_phone_number,
    traits.phone,
    traits.phone_number,
    traits.whatsapp_number,
    traits.whatsapp,
    traits.mobile,
  ];
  for (const c of candidates) {
    const digits = String(c || "").replace(/\D/g, "");
    if (digits.length >= 8) return String(c);
  }
  return "";
}

function pickCountryCode(user = {}, phoneRaw = "") {
  const traits = user.traits || user.Traits || {};
  let cc =
    user.countryCode ||
    user.country_code ||
    traits.country_code ||
    traits.countryCode ||
    "";
  const digits = String(phoneRaw || "").replace(/\D/g, "");
  if (!cc && digits.startsWith("966")) cc = "+966";
  if (!cc) cc = "+966";
  if (!String(cc).startsWith("+")) cc = `+${cc}`;
  return cc;
}

function mapUser(user) {
  const traits = user.traits || user.Traits || {};
  const phoneRaw = pickPhone(user);
  return {
    phone: phoneRaw,
    countryCode: pickCountryCode(user, phoneRaw),
    name: traits.name || user.name || user.user_name || "",
    created_at_utc:
      user.created_at_utc ||
      traits.created_at_utc ||
      user.createdAt ||
      user.created_at,
    modified_at_utc:
      user.modified_at_utc ||
      traits.modified_at_utc ||
      user.updatedAt ||
      user.updated_at ||
      user.modifiedAt,
  };
}

/** جهات تجريبية من Interakt مثل "Karthik Menon [Sample]" */
function isSampleContact(userOrMapped = {}) {
  const traits = userOrMapped.traits || userOrMapped.Traits || {};
  const name = String(
    userOrMapped.name || traits.name || userOrMapped.user_name || ""
  ).toLowerCase();
  return name.includes("[sample]") || name.includes("(sample)");
}

async function syncPages({ apiKey, filters, maxPages, onUser }) {
  let offset = 0;
  const limit = 100;
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skippedNoPhone = 0;
  let skippedSample = 0;
  let pages = 0;
  let lastPayloadKeys = [];
  let sampleUserKeys = [];

  while (pages < maxPages) {
    const payload = await fetchInteraktUsersPage({
      apiKey,
      offset,
      limit,
      filters,
    });
    lastPayloadKeys = Object.keys(payload || {});
    const users = extractUsers(payload);
    pages += 1;
    if (!users.length) break;
    if (!sampleUserKeys.length && users[0]) {
      sampleUserKeys = Object.keys(users[0]);
    }

    for (const user of users) {
      const mapped = mapUser(user);
      if (!String(mapped.phone || "").replace(/\D/g, "")) {
        skippedNoPhone += 1;
        continue;
      }
      if (isSampleContact(user) || isSampleContact(mapped)) {
        skippedSample += 1;
        continue;
      }
      fetched += 1;
      const result = onUser?.(mapped);
      if (result?.created) created += 1;
      else if (result) updated += 1;
    }

    if (!hasNextPage(payload, users.length, limit)) break;
    offset += limit;
  }

  return {
    fetched,
    created,
    updated,
    skippedNoPhone,
    skippedSample,
    pages,
    lastPayloadKeys,
    sampleUserKeys,
  };
}

/**
 * يجلب جهات الاتصال — يجرّب أكثر من فلتر حتى ما يرجع فاضي بدون سبب
 */
async function syncInteraktUsersSince({
  apiKey,
  sinceIso,
  maxPages = 20,
  onUser,
}) {
  if (!apiKey) {
    return { ok: false, error: "INTERAKT_API_KEY غير مضبوط", fetched: 0 };
  }

  const attempts = [
    {
      name: "modified_at_utc",
      filters: [{ trait: "modified_at_utc", op: "gt", val: sinceIso }],
    },
    {
      name: "created_at_utc",
      filters: [{ trait: "created_at_utc", op: "gt", val: sinceIso }],
    },
    { name: "all", filters: null },
  ];

  let best = null;
  const attemptLogs = [];

  for (const attempt of attempts) {
    try {
      const result = await syncPages({
        apiKey,
        filters: attempt.filters,
        maxPages: attempt.name === "all" ? Math.min(maxPages, 5) : maxPages,
        onUser,
      });
      attemptLogs.push({
        name: attempt.name,
        fetched: result.fetched,
        pages: result.pages,
        skippedNoPhone: result.skippedNoPhone,
        keys: result.lastPayloadKeys,
        sampleUserKeys: result.sampleUserKeys,
      });
      if (!best || result.fetched > best.fetched) {
        best = { ...result, filterUsed: attempt.name };
      }
      if (result.fetched > 0) break;
    } catch (err) {
      attemptLogs.push({
        name: attempt.name,
        error: err.message,
        status: err.status || null,
        details: err.details || null,
      });
      // لو المفتاح/الخطة ترفض Get Users نوقف فورًا
      if (err.status === 401 || err.status === 403 || err.status === 404) {
        return {
          ok: false,
          error: err.message,
          status: err.status,
          details: err.details || null,
          hint:
            "تأكد أن Get Users API متاح في خطة Interakt (عادة Growth فأعلى) وأن المفتاح صحيح من Developer Setting",
          attempts: attemptLogs,
          fetched: 0,
        };
      }
    }
  }

  if (!best) {
    return {
      ok: false,
      error: "فشل جلب المستخدمين من Interakt",
      attempts: attemptLogs,
      fetched: 0,
    };
  }

  return {
    ok: true,
    ...best,
    attempts: attemptLogs,
    hint:
      best.fetched === 0
        ? "Interakt رجّع صفر جهات اتصال قابلة للقراءة. جرّب تبويب «الكل»، أو تأكد أن جهات الاتصال موجودة في Interakt Contacts وأن الخطة تدعم Get Users API."
        : "الجلب من Interakt يجيب الرقم والاسم فقط — المسار والمبلغ وعدد الرسائل تتعبّى لما العميل يكلم البوت.",
  };
}

module.exports = {
  fetchInteraktUsersPage,
  syncInteraktUsersSince,
  extractUsers,
  mapUser,
  pickPhone,
  isSampleContact,
};
