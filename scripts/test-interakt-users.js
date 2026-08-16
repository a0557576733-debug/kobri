const assert = require("assert");
const {
  extractUsers,
  mapUser,
  pickPhone,
  isSampleContact,
} = require("../lib/interakt-users");
const {
  createCustomerLedger,
  calendarDayKey,
} = require("../lib/customer-ledger");
const fs = require("fs");
const os = require("os");
const path = require("path");

const nested = {
  result: true,
  data: {
    has_next_page: false,
    users: [
      {
        id: "u1",
        phoneNumber: "508031055",
        countryCode: "+966",
        traits: { name: "أحمد" },
        modified_at_utc: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "u2",
        phone_number: "533248917",
        country_code: "966",
        Traits: { name: "سارة" },
      },
    ],
  },
};

const users = extractUsers(nested);
assert.strictEqual(users.length, 2);

const mapped = mapUser(users[0]);
assert.strictEqual(pickPhone(users[0]), "508031055");
assert.strictEqual(mapped.countryCode, "+966");
assert.ok(mapped.modified_at_utc);

const deep = {
  payload: {
    wrap: {
      contacts: [
        { id: "x", traits: { phone: "0555123456", name: "خالد" } },
        { id: "noise", foo: 1 },
      ],
    },
  },
};
assert.strictEqual(extractUsers(deep).length, 1);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-sync-"));
const ledger = createCustomerLedger({
  dataFile: path.join(dir, "customers.json"),
  backupDir: path.join(dir, "backups"),
});

const old = ledger.upsertContact({
  phone: "501111111",
  countryCode: "+966",
  name: "قديم",
  lastSeenAt: "2020-01-01T00:00:00.000Z",
  touchNow: false,
});
assert.ok(old.created);

const touched = ledger.upsertContact({
  phone: "501111111",
  countryCode: "+966",
  name: "قديم",
  lastSeenAt: "2020-01-01T00:00:00.000Z",
  touchNow: true,
});
assert.ok(!touched.created);
assert.ok(touched.row.syncedAt);
assert.strictEqual(
  calendarDayKey(new Date(touched.row.lastSeenAt)),
  calendarDayKey()
);
assert.ok(
  ledger.listByDay("today").customers.some((c) => c.phone === "501111111")
);

assert.ok(
  isSampleContact({ name: "Karthik Menon [Sample]", phone: "508031055" })
);
assert.ok(!isSampleContact({ name: "أحمد", phone: "508031055" }));

console.log("OK: interakt extract/map + ledger touchNow sync day");
