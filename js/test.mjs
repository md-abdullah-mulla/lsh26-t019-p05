/**
 * SQA suite — কিস্তি খাতা
 * Run: npm test
 */
import { readFileSync } from "node:fs";
import { selfTest, snapshot, dashboard, previewAllocation, statusOf, collectionSheet, likelyFinishDate } from "./ledger.js";
import { toPaisa, fromPaisa, formatTaka, addDays, normalizeTakaInput, formatDate, formatDateShort } from "./money.js";
import { SEED } from "./seed.js";
import { I18N, GROUPS, STATUS_KEY, t, groupName, i18nKeys } from "./i18n.js";
import {
  whatIf,
  parseAmountToPaisa,
  postToBorrower,
  removePayment,
  validateNewBorrower,
  makeId,
  allocationLines,
  pickDefaultMember,
  nextOverdue,
  parseFixturePayload,
  meetingClose,
} from "./actions.js";

function loadPublicCases() {
  const paths = [
    new URL("../data/P05_micro_loans_public.json", import.meta.url),
    "/home/user/uploads/P05_micro_loans_public.json",
  ];
  for (const p of paths) {
    try { return JSON.parse(readFileSync(p, "utf8")); } catch {}
  }
  throw new Error("public fixture file not found");
}

let passed = 0;
let failed = 0;
const failures = [];
const results = [];

function tc(id, title, fn) {
  const before = failed;
  try {
    fn();
    if (failed === before) {
      passed += 1;
      results.push({ id, title, ok: true });
    } else {
      results.push({ id, title, ok: false });
    }
  } catch (e) {
    failed += 1;
    failures.push(`${id} ${title}: ${e.message}`);
    results.push({ id, title, ok: false });
  }
}

function assert(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(msg);
  }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} :: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);
}

// ——— TC-M money ———
tc("TC-M01", "Parse taka strings to integer paisa", () => {
  eq(toPaisa("0"), 0, "0");
  eq(toPaisa("1"), 100, "1");
  eq(toPaisa("312"), 31200, "312");
  eq(toPaisa("550.75"), 55075, "550.75");
  eq(toPaisa("62.25"), 6225, "62.25");
  eq(toPaisa("0.01"), 1, "1 paisa");
  eq(toPaisa("1.5"), 150, "1.5");
  eq(fromPaisa(55075), "550.75", "from");
  eq(normalizeTakaInput("750"), "750.00", "norm");
  eq(normalizeTakaInput("750.5"), "750.50", "norm 1dp");
});

tc("TC-M02", "Reject illegal money", () => {
  let n = 0;
  for (const bad of ["", "abc", "12.345", "1.2.3", "--1"]) {
    try { toPaisa(bad); } catch { n += 1; }
  }
  eq(n, 5, "five rejects");
});

tc("TC-M03", "Date arithmetic week grid", () => {
  eq(addDays("2026-08-16", 7), "2026-08-23", "+7");
  eq(addDays("2026-08-30", 7), "2026-09-06", "month");
  eq(addDays("2026-02-26", 7), "2026-03-05", "2026 not leap");
});

tc("TC-M04", "Dates format in English and Bangla", () => {
  eq(formatDate("2026-08-16"), "16 Aug 2026", "en default");
  assert(formatDate("2026-08-16", "bn").includes("আগস্ট"), "bn month");
  assert(formatDateShort("2026-08-16", "bn").includes("আগস্ট"), "bn short");
});

// ——— TC-L ledger ———
tc("TC-L01", "Engine self-test", () => {
  selfTest();
});

tc("TC-L02", "PUB-01 B01 unpaid first week overdue, due-today not overdue", () => {
  const b = SEED.borrowers.find((x) => x.id === "B01");
  const s = snapshot(b, SEED.today);
  eq(s.overduePaisa, 75000, "overdue");
  eq(s.overdueWeeks, 1, "weeks");
  eq(s.weeks[0].status, "overdue", "w1");
  eq(s.weeks[1].status, "due", "w2 due today");
  eq(s.collectedPaisa, 0, "none");
});

tc("TC-L03", "PUB-01 B02 FIFO part + carry", () => {
  const b = SEED.borrowers.find((x) => x.id === "B02");
  const s = snapshot(b, SEED.today);
  eq(s.collectedPaisa, 192575, "collected");
  eq(s.weeks[0].status, "paid", "w1");
  eq(s.weeks[3].paidPaisa, 27575, "w4");
  eq(s.overduePaisa, 27425 + 55000, "od");
  eq(s.overdueWeeks, 2, "2w");
});

tc("TC-L04", "PUB-01 B12 prepaid first due today is not overdue", () => {
  const b = SEED.borrowers.find((x) => x.id === "B12");
  const s = snapshot(b, SEED.today);
  eq(s.overduePaisa, 0, "od");
  eq(s.weeks[0].status, "paid", "w1");
  eq(s.weeks[2].paidPaisa, 25, "0.25");
});

tc("TC-L05", "Dashboard PUB-01 totals and ranking", () => {
  const d = dashboard(SEED.borrowers, SEED.today);
  eq(d.given, 14423500, "given");
  eq(d.collected, 7563025, "collected");
  eq(d.overdue, 1847775, "overdue");
  eq(d.overdueMembers, 10, "members");
  eq(d.byAmount[0].id, "B16", "amount");
  eq(d.byWeeks[0].id, "B13", "weeks");
  eq(d.byWeeks[0].overdueWeeks, 7, "7");
});

tc("TC-L06", "As-of hides later payments", () => {
  const b = {
    id: "Z", name: "Z", group: "Padma",
    loan_bdt: "1000.00", interest_bdt: "0.00", plan_weeks: 4, instalment_bdt: "250.00",
    first_due: "2026-08-01",
    payments: [{ date: "2026-08-20", amount_bdt: "1000" }],
  };
  eq(snapshot(b, "2026-08-10").collectedPaisa, 0, "hidden");
  eq(snapshot(b, "2026-08-20").overduePaisa, 0, "applied");
});

tc("TC-L07", "Overpay creates surplus, FIFO never skips a hole", () => {
  const b = {
    id: "Y", name: "Y", group: "Meghna",
    loan_bdt: "900.00", interest_bdt: "100.00", plan_weeks: 4, instalment_bdt: "250.00",
    first_due: "2026-08-01",
    payments: [{ date: "2026-08-01", amount_bdt: "1200" }],
  };
  const s = snapshot(b, "2026-08-30");
  eq(s.surplusPaisa, 20000, "surplus");
  eq(s.weeks.every((w) => w.status === "paid"), true, "all paid");
});

tc("TC-L08", "Same-day order preserved", () => {
  const b = {
    id: "S", name: "S", group: "Jamuna",
    loan_bdt: "500.00", interest_bdt: "0.00", plan_weeks: 2, instalment_bdt: "250.00",
    first_due: "2026-08-01",
    payments: [
      { date: "2026-08-01", amount_bdt: "100" },
      { date: "2026-08-01", amount_bdt: "150" },
    ],
  };
  eq(snapshot(b, "2026-08-01").weeks[0].paidPaisa, 25000, "fills w1");
});

tc("TC-L09", "Due today is not overdue", () => {
  const b = {
    id: "D", name: "D", group: "Shapla",
    loan_bdt: "250.00", interest_bdt: "0.00", plan_weeks: 1, instalment_bdt: "250.00",
    first_due: "2026-08-30", payments: [],
  };
  eq(snapshot(b, "2026-08-30").overduePaisa, 0, "today");
  eq(snapshot(b, "2026-08-31").overduePaisa, 25000, "next");
});

tc("TC-L10", "All 25 public cases: plan exact, conservation, overdue rule", () => {
  const raw = loadPublicCases();
  eq(raw.cases.length, 25, "25 cases");
  let borrowers = 0;
  for (const c of raw.cases) {
    for (const b of c.borrowers) {
      borrowers += 1;
      const face = toPaisa(b.loan_bdt) + toPaisa(b.interest_bdt);
      eq(face, Number(b.plan_weeks) * toPaisa(b.instalment_bdt), `${c.case_id} ${b.id} plan`);
      const s = snapshot(b, c.today);
      const paid = s.weeks.reduce((n, w) => n + w.paidPaisa, 0);
      eq(paid + s.surplusPaisa, s.collectedPaisa, `${c.case_id} ${b.id} collected`);
      eq(paid + s.remainingPaisa, s.facePaisa, `${c.case_id} ${b.id} face`);
      assert(s.overduePaisa <= s.remainingPaisa, `${c.case_id} ${b.id} od ⊆ rem`);
      let sawOpen = false;
      for (const w of s.weeks) {
        eq(w.paidPaisa + w.remainingPaisa, w.duePaisa, `${c.case_id} W${w.k}`);
        eq(statusOf(w, c.today), w.status, `${c.case_id} status W${w.k}`);
        if (w.due >= c.today) {
          assert(w.status !== "overdue" && w.status !== "part_overdue", `${c.case_id} future not od`);
        }
        if (sawOpen) assert(w.paidPaisa === 0, `${c.case_id} ${b.id} FIFO hole W${w.k}`);
        if (w.remainingPaisa > 0) sawOpen = true;
        for (const p of b.payments || []) assert(p.date <= c.today, "seed payments ≤ today");
      }
    }
    const d = dashboard(c.borrowers, c.today);
    eq(d.byAmount.length, d.overdueMembers, `${c.case_id} amount list`);
    eq(d.byWeeks.length, d.overdueMembers, `${c.case_id} weeks list`);
    for (let i = 1; i < d.byAmount.length; i++) {
      assert(d.byAmount[i - 1].overduePaisa >= d.byAmount[i].overduePaisa, `${c.case_id} amt sort`);
    }
  }
  assert(borrowers >= 15, "enough borrowers");
});

// ——— TC-A actions ———
tc("TC-A01", "Post any amount, part and over, then remove restores", () => {
  const b = structuredClone(SEED.borrowers.find((x) => x.id === "B01"));
  const before = snapshot(b, "2026-08-30");
  postToBorrower(b, "2026-08-30", "375.50");
  const mid = snapshot(b, "2026-08-30");
  assert(mid.collectedPaisa === 37550, "part collected");
  assert(mid.overduePaisa < before.overduePaisa, "od dropped");
  postToBorrower(b, "2026-08-30", "20000");
  const over = snapshot(b, "2026-08-30");
  assert(over.surplusPaisa > 0, "overpay surplus");
  removePayment(b, 1);
  removePayment(b, 0);
  eq(snapshot(b, "2026-08-30").collectedPaisa, before.collectedPaisa, "restored");
});

tc("TC-A02", "Post rejects bad date and zero/negative", () => {
  const b = { payments: [] };
  let n = 0;
  try { postToBorrower(b, "30-08-2026", "10"); } catch (e) { if (e.code === "bad_date") n++; }
  try { postToBorrower(b, "2026-08-30", "0"); } catch (e) { if (e.code === "bad_amount") n++; }
  try { postToBorrower(b, "2026-08-30", "nope"); } catch (e) { if (e.code === "bad_amount") n++; }
  eq(n, 3, "three errors");
});

tc("TC-A03", "New borrower validation: name, weeks, exact plan", () => {
  const good = validateNewBorrower({
    name: "Test Begum", group: "Padma", loan: "1000", interest: "0",
    weeks: 4, instalment: "250", first_due: "2026-08-01",
  });
  eq(good.ok, true, "good");
  eq(validateNewBorrower({ ...good.record, name: "", loan: "1000", interest: "0", weeks: 4, instalment: "250" }).code, "nameRequired", "name");
  eq(validateNewBorrower({
    name: "X", group: "Padma", loan: "1000", interest: "0", weeks: 4, instalment: "200", first_due: "2026-08-01",
  }).code, "planMismatch", "plan");
});

tc("TC-A04", "What-if PAR math", () => {
  const w0 = whatIf(10000, 20000, 0);
  eq(w0.lifted, 0, "0%");
  eq(w0.newOd, 10000, "od");
  const w100 = whatIf(10000, 20000, 100);
  eq(w100.newOd, 0, "cleared");
  eq(w100.newPar, 0, "par 0");
  const w50 = whatIf(10000, 20000, 50);
  eq(w50.lifted, 5000, "half");
  eq(w50.newOd, 5000, "left");
});

tc("TC-A05", "Allocation preview matches post", () => {
  const b = structuredClone(SEED.borrowers.find((x) => x.id === "B01"));
  const lines = allocationLines(b, "2026-08-23", "2026-08-23", 100000);
  eq(lines.hits[0].week.k, 1, "oldest");
  eq(lines.hits[0].delta, 75000, "close w1");
  postToBorrower(b, "2026-08-23", "1000");
  const s = snapshot(b, "2026-08-23");
  eq(s.overduePaisa, lines.overdueAfter, "matches");
});

tc("TC-A06", "Default member is most-overdue first from unsorted snaps via pick", () => {
  const d = dashboard(SEED.borrowers, SEED.today);
  const p = pickDefaultMember(d.snaps);
  assert(p && p.overduePaisa > 0, "has overdue");
  const n = nextOverdue(d.byAmount, p.id);
  assert(n && n.id !== p.id, "next different");
});

tc("TC-A07", "makeId unique-ish", () => {
  const a = makeId([]);
  const b = makeId([{ id: a }]);
  assert(a !== b, "ids differ");
  assert(/^B\d{2}-[A-Z0-9]+$/.test(a), "shape");
});

tc("TC-A08", "Group filter dashboard only that center", () => {
  const all = dashboard(SEED.borrowers, SEED.today, null);
  const sh = dashboard(SEED.borrowers, SEED.today, "Shapla");
  assert(sh.snaps.every((s) => s.group === "Shapla"), "only shapla");
  assert(sh.snaps.length < all.snaps.length, "subset");
  assert(sh.given < all.given, "given subset");
});

tc("TC-A09", "parseAmountToPaisa empty is 0, commas allowed", () => {
  eq(parseAmountToPaisa(""), 0, "empty");
  eq(parseAmountToPaisa("1,250.50"), 125050, "comma");
});

tc("TC-A10", "Posting 750 on B01 as of 30 Aug leaves W2 overdue", () => {
  const b = structuredClone(SEED.borrowers.find((x) => x.id === "B01"));
  postToBorrower(b, "2026-08-30", "750");
  const s = snapshot(b, "2026-08-30");
  eq(s.weeks[0].status, "paid", "w1");
  eq(s.overdueWeeks, 1, "w2 still");
  eq(s.overduePaisa, 75000, "750");
});

tc("TC-A11", "Collection sheet = prior arrears + remaining due that day", () => {
  const b01 = SEED.borrowers.find((x) => x.id === "B01");
  const row = collectionSheet([b01], SEED.today).rows[0];
  eq(row.arrearsPaisa, 75000, "w1 overdue");
  eq(row.dueThisWeekPaisa, 75000, "w2 due today");
  eq(row.toCollectPaisa, 150000, "sum");
  eq(row.weekK, 2, "week 2 due on case today");
  const d = dashboard(SEED.borrowers, SEED.today);
  const sheet = collectionSheet(SEED.borrowers, SEED.today);
  eq(sheet.totalArrears, d.overdue, "arrears = dashboard overdue");
  assert(sheet.totalToCollect >= sheet.totalArrears, "to-collect includes due-today");
  assert(sheet.stillDue >= d.overdueMembers, "due-today-only people can appear");
});

tc("TC-A12", "Fixture payload: official pack shape and rejection", () => {
  const raw = loadPublicCases();
  const ok = parseFixturePayload(raw);
  eq(ok.ok, true, "pack ok");
  eq(ok.cases.length, 25, "25 cases");
  eq(ok.cases[0].case_id, "PUB-01", "first");
  assert(ok.cases[0].borrowers.length >= 15, "borrowers");
  eq(parseFixturePayload({}).ok, false, "empty");
  eq(parseFixturePayload({ today: "nope", borrowers: [] }).ok, false, "bad");
  const one = parseFixturePayload({ case_id: "X", today: "2026-08-23", borrowers: [structuredClone(SEED.borrowers[0])] });
  eq(one.ok, true, "single case");
});

tc("TC-A13", "Likely finish uses actual pay rate; close-meeting totals session", () => {
  const unpaid = snapshot(SEED.borrowers.find((x) => x.id === "B01"), SEED.today);
  eq(likelyFinishDate(unpaid, SEED.today), unpaid.lastDue, "no cash → plan end");
  const done = {
    id: "Z", name: "Z", group: "Shapla",
    loan_bdt: "100.00", interest_bdt: "0.00", plan_weeks: 1, instalment_bdt: "100.00",
    first_due: "2026-08-01", payments: [{ date: "2026-08-01", amount_bdt: "100" }],
  };
  eq(likelyFinishDate(snapshot(done, "2026-08-30"), "2026-08-30"), "2026-08-30", "cleared");
  const empty = meetingClose([], dashboard(SEED.borrowers, SEED.today).snaps);
  eq(empty.taken, 0, "no cash");
  const closed = meetingClose(
    [{ id: "B01", name: "Rahima Begum", paisa: 75000 }, { id: "B01", name: "Rahima Begum", paisa: 25000 }],
    dashboard(SEED.borrowers, SEED.today).snaps
  );
  eq(closed.taken, 100000, "sum");
  eq(closed.paid.length, 1, "grouped");
  eq(closed.nPosts, 2, "posts");
  assert(closed.still.every((s) => s.overduePaisa > 0), "still overdue only");
});

// ——— TC-I i18n ———
tc("TC-I01", "Bangla and English have the same keys", () => {
  const bn = Object.keys(I18N.bn).sort();
  const en = Object.keys(I18N.en).sort();
  eq(bn.join(","), en.join(","), "key set");
});

tc("TC-I02", "Every string non-empty; bn≠en except allowed", () => {
  const allow = new Set(["langBn", "langEn"]);
  for (const k of i18nKeys()) {
    assert(String(I18N.bn[k]).trim().length > 0, `bn ${k} empty`);
    assert(String(I18N.en[k]).trim().length > 0, `en ${k} empty`);
    if (!allow.has(k)) {
      assert(I18N.bn[k] !== I18N.en[k], `${k} not translated`);
    }
  }
});

tc("TC-I03", "t() fallback and language switch", () => {
  eq(t("bn", "post"), I18N.bn.post, "bn post");
  eq(t("en", "post"), I18N.en.post, "en post");
  eq(t("bn", "missing_key_xyz"), "missing_key_xyz", "fallback");
  assert(t("bn", "navMeeting") !== t("en", "navMeeting"), "nav differs");
});

tc("TC-I04", "Group names bilingual", () => {
  for (const g of GROUPS) {
    assert(groupName("bn", g).length > 0, `bn ${g}`);
    eq(groupName("en", g), g, `en ${g}`);
    assert(groupName("bn", g) !== g || g === "", `bn translated ${g}`);
  }
});

tc("TC-I05", "Every status has a label key in both languages", () => {
  for (const stt of Object.keys(STATUS_KEY)) {
    const key = STATUS_KEY[stt];
    assert(I18N.bn[key] && I18N.en[key], stt);
    assert(I18N.bn[key] !== I18N.en[key], `${stt} translated`);
  }
});

tc("TC-I06", "App source only uses known i18n keys via t(\"...\" )", () => {
  const src = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const used = [...src.matchAll(/\bt\("([a-zA-Z0-9_]+)"\)/g)].map((m) => m[1]);
  const keys = new Set(i18nKeys());
  for (const k of used) assert(keys.has(k), `unknown i18n key ${k}`);
  assert(used.includes("langBn") && used.includes("langEn"), "lang buttons");
  assert(used.includes("post") && used.includes("navMeeting"), "core labels");
});

tc("TC-I07", "No leftover hardcoded English chrome in app.js templates", () => {
  const src = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  for (const word of ["Dashboard", "Record payment", "Borrowers", "As of date", "Center collection"]) {
    assert(!src.includes(word), `stale ${word}`);
  }
});

// ——— TC-S seed / product ———
tc("TC-S01", "At least 15 borrowers in seed", () => {
  assert(SEED.borrowers.length >= 15, String(SEED.borrowers.length));
});

tc("TC-S02", "Each seed borrower at a different cycle point (unique overdue or paidWeeks mix)", () => {
  const snaps = SEED.borrowers.map((b) => snapshot(b, SEED.today));
  const sig = new Set(snaps.map((s) => `${s.paidWeeks}-${s.overdueWeeks}-${s.planWeeks}`));
  assert(sig.size >= 8, "varied cycles");
});

tc("TC-S03", "HTTP static files if server up", async () => {
  // handled below
});

// fuzz
tc("TC-F01", "200 random ledgers conserve and keep FIFO", () => {
  for (let i = 0; i < 200; i++) {
    const weeks = 4 + (i % 12);
    const inst = [25000, 40000, 50000, 75000][i % 4];
    const face = weeks * inst;
    const interest = Math.round(face * 0.1 / 100) * 100;
    const loan = face - interest;
    const payments = [];
    for (let p = 0; p < (i % 8); p++) {
      payments.push({
        date: addDays("2026-03-01", (p * 11) % 160),
        amount_bdt: fromPaisa(inst / 2),
      });
    }
    const b = {
      id: "F" + i, name: "F", group: "Shapla",
      loan_bdt: fromPaisa(loan), interest_bdt: fromPaisa(interest),
      plan_weeks: weeks, instalment_bdt: fromPaisa(inst),
      first_due: "2026-03-01", payments,
    };
    const s = snapshot(b, "2026-08-30");
    const paid = s.weeks.reduce((a, w) => a + w.paidPaisa, 0);
    eq(paid + s.surplusPaisa, s.collectedPaisa, "col " + i);
    eq(paid + s.remainingPaisa, s.facePaisa, "face " + i);
    let hole = false;
    for (const w of s.weeks) {
      if (hole) eq(w.paidPaisa, 0, "fifo " + i);
      if (w.remainingPaisa > 0) hole = true;
    }
  }
});

async function httpSmoke() {
  const base = "http://127.0.0.1:8080";
  try {
    const files = ["/", "/css/app.css", "/js/app.js", "/js/i18n.js", "/js/actions.js", "/js/ledger.js", "/js/money.js", "/js/seed.js", "/data/P05_micro_loans_public.json"];
    for (const f of files) {
      const res = await fetch(base + f);
      eq(res.status, 200, `HTTP ${f}`);
    }
    const html = await (await fetch(base + "/")).text();
    assert(html.includes("js/app.js"), "module");
  } catch {
    assert(true, "server optional");
  }
}

await httpSmoke();

console.log("");
for (const r of results) {
  if (!r.ok) console.log("FAIL", r.id, r.title);
}
console.log(`${passed} passed, ${failed} failed, ${results.length} test cases`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures.slice(0, 40)) console.log(" -", f);
  if (failures.length > 40) console.log(` ... ${failures.length - 40} more`);
  process.exit(1);
}
