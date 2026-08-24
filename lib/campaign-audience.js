/**
 * أرقام حملات إنترأكت السابقة — لتفادي تكرار نفس الجمهور في CSV
 */
const fs = require("fs");
const path = require("path");

function normalizeAudiencePhone(raw) {
  let phone = String(raw || "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
  if (phone.startsWith("966") && phone.length > 9) phone = phone.slice(3);
  return phone;
}

function parsePhonesFromText(text) {
  const phones = [];
  const seen = new Set();
  const chunks = String(text || "").split(/[\s,;]+/);
  for (const token of chunks) {
    const phone = normalizeAudiencePhone(token);
    if (phone.length < 8 || seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return phones;
}

function createCampaignAudience(options = {}) {
  const dataFile =
    options.dataFile ||
    path.join(__dirname, "..", "data", "campaign-audience.json");
  let phones = new Set();
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      if (!fs.existsSync(dataFile)) return;
      const raw = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      const list = Array.isArray(raw?.phones) ? raw.phones : [];
      phones = new Set(list.map(normalizeAudiencePhone).filter(Boolean));
    } catch (err) {
      console.error("[campaign-audience:load]", err.message);
      phones = new Set();
    }
  }

  function save() {
    load();
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      const payload = {
        updatedAt: new Date().toISOString(),
        count: phones.size,
        phones: [...phones],
      };
      fs.writeFileSync(dataFile, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      console.error("[campaign-audience:save]", err.message);
    }
  }

  function addMany(list) {
    load();
    let added = 0;
    for (const raw of list || []) {
      const phone = normalizeAudiencePhone(raw);
      if (!phone || phones.has(phone)) continue;
      phones.add(phone);
      added += 1;
    }
    if (added) save();
    return { added, count: phones.size };
  }

  function buildCsv(rawText, { remember = true } = {}) {
    load();
    const incoming = parsePhonesFromText(rawText);
    const unique = [];
    let skipped = 0;
    for (const phone of incoming) {
      if (phones.has(phone)) {
        skipped += 1;
        continue;
      }
      unique.push(phone);
    }
    if (remember) addMany(unique);
    const csv =
      ["countryCode,phoneNumber", ...unique.map((p) => `+966,${p}`)].join("\n") +
      (unique.length ? "\n" : "");
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      csv,
      count: unique.length,
      skipped,
      filename: `interakt-audience-${stamp}.csv`,
    };
  }

  function importCsv(text) {
    return addMany(parsePhonesFromText(text));
  }

  return {
    count() {
      load();
      return phones.size;
    },
    has(phone) {
      load();
      return phones.has(normalizeAudiencePhone(phone));
    },
    addMany,
    buildCsv,
    importCsv,
    parsePhonesFromText,
    _dataFile: dataFile,
  };
}

module.exports = {
  createCampaignAudience,
  parsePhonesFromText,
  normalizeAudiencePhone,
};
