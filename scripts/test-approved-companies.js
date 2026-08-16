const assert = require("assert");
const {
  searchApprovedCompanies,
  parseCivilianSubtype,
  getApprovedCompanyCount,
  parseCompanyPick,
  companyListInteractive,
  looksLikeCompanyResearch,
  COMPANY_RESEARCH_ID,
} = require("../lib/approved-companies");
const {
  advancePersonalFinanceFlow,
  startPersonalFinanceFlow,
} = require("../lib/conversation");

assert.ok(getApprovedCompanyCount() > 2000);

assert.strictEqual(parseCivilianSubtype("حكومي"), "government");
assert.strictEqual(parseCivilianSubtype("قطاع خاص"), "private");
assert.strictEqual(parseCivilianSubtype("civilian_private"), "private");

const banks = searchApprovedCompanies("البنك");
assert.ok(banks.length >= 1, "expect bank matches");
assert.ok(banks.length <= 10);

const start = startPersonalFinanceFlow({ askSector: true });
assert.strictEqual(start.draft.step, "sector");

const afterCivilian = advancePersonalFinanceFlow(start.draft, "مدني");
assert.strictEqual(afterCivilian.draft.step, "civilian_subtype");
assert.strictEqual(afterCivilian.interactive?.buttons?.length, 2);

const afterGov = advancePersonalFinanceFlow(afterCivilian.draft, "حكومي");
assert.strictEqual(afterGov.draft.step, "salary");
assert.strictEqual(afterGov.draft.civilianSubtype, "government");

const afterPrivate = advancePersonalFinanceFlow(afterCivilian.draft, "قطاع خاص");
assert.strictEqual(afterPrivate.draft.step, "company_name");

const search = advancePersonalFinanceFlow(afterPrivate.draft, "الراجحي");
assert.strictEqual(search.draft.step, "company_pick");
assert.ok(search.interactive?.rows?.length >= 1);
assert.ok(search.draft.companyMatches?.length >= 1);

const picked = advancePersonalFinanceFlow(search.draft, "co_0");
assert.strictEqual(picked.draft.step, "salary");
assert.ok(picked.draft.companyName);
assert.strictEqual(picked.draft.companyApproved, true);
assert.strictEqual(picked.draft.jobCategory, "private");

const { resolveInterestRate } = require("../lib/interest-rate");
assert.strictEqual(resolveInterestRate({ jobCategory: "private" }), 15.5);
assert.strictEqual(
  resolveInterestRate({ jobCategory: "civilian", civilianSubtype: "private" }),
  15.5
);
assert.strictEqual(resolveInterestRate({ jobCategory: "civilian" }), 13);

const list = companyListInteractive(banks.slice(0, 3));
assert.ok(list.rows.every((r) => r.title.length <= 24));
assert.ok(list.rows.some((r) => r.id === COMPANY_RESEARCH_ID));
assert.ok(list.rows.length <= 10);
assert.ok(looksLikeCompanyResearch(COMPANY_RESEARCH_ID));

const hit = parseCompanyPick("co_1", banks.slice(0, 3));
assert.ok(hit);

const research = advancePersonalFinanceFlow(search.draft, COMPANY_RESEARCH_ID);
assert.strictEqual(research.draft.step, "company_name");
assert.match(research.reply, /من جديد|اكتب اسم/);

const miss = advancePersonalFinanceFlow(afterPrivate.draft, "شركة وهمية ١٢٣٤٥٦");
assert.ok(/ما لقينا|نعتذر/.test(miss.reply));

// واتساب يرسل عنوان الصف المقطوع بدل co_0 — لازم يكمل للراتب
const again = advancePersonalFinanceFlow(afterPrivate.draft, "الجريسي");
assert.strictEqual(again.draft.step, "company_pick");
const truncatedTitle = again.draft.companyMatches[0].listTitle;
assert.ok(truncatedTitle);
const byTitle = advancePersonalFinanceFlow(again.draft, truncatedTitle);
assert.strictEqual(byTitle.draft.step, "salary", "اختيار بالعنوان المقطوع");
assert.ok(byTitle.draft.companyName);

const { pickInteractiveLabel } = require("../lib/webhook-parse");
assert.strictEqual(
  pickInteractiveLabel({
    list_reply: { id: "co_2", title: "الجريسي للانتاج الزرا..." },
  }),
  "co_2"
);

console.log("OK: approved companies + civilian gov/private flow");
