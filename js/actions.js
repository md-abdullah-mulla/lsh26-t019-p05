import { toPaisa, fromPaisa, normalizeTakaInput } from "./money.js";
import { snapshot, previewAllocation, dashboard } from "./ledger.js";

export function whatIf(overduePaisa, remainingPaisa, pct) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const lifted = Math.round((overduePaisa * p) / 100);
  const newOd = overduePaisa - lifted;
  const newRem = Math.max(0, remainingPaisa - lifted);
  const newPar = newRem > 0 ? newOd / newRem : 0;
  const oldPar = remainingPaisa > 0 ? overduePaisa / remainingPaisa : 0;
  return { pct: p, lifted, newOd, newRem, newPar, oldPar };
}

export function parseAmountToPaisa(raw) {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!s) return 0;
  return toPaisa(s);
}

export function postToBorrower(borrower, date, amountRaw) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const err = new Error("bad_date");
    err.code = "bad_date";
    throw err;
  }
  let amt;
  try {
    amt = normalizeTakaInput(amountRaw);
  } catch {
    const err = new Error("bad_amount");
    err.code = "bad_amount";
    throw err;
  }
  if (toPaisa(amt) <= 0) {
    const err = new Error("bad_amount");
    err.code = "bad_amount";
    throw err;
  }
  if (!Array.isArray(borrower.payments)) borrower.payments = [];
  borrower.payments.push({ date, amount_bdt: amt });
  return { amount_bdt: amt, paisa: toPaisa(amt) };
}

export function removePayment(borrower, seq) {
  const list = borrower.payments || [];
  if (!Number.isInteger(seq) || seq < 0 || seq >= list.length) {
    const err = new Error("bad_seq");
    err.code = "bad_seq";
    throw err;
  }
  borrower.payments = list.filter((_, i) => i !== seq);
}

export function validateNewBorrower({ name, group, loan, interest, weeks, instalment, first_due }) {
  if (!String(name || "").trim()) return { ok: false, code: "nameRequired" };
  const w = Number(weeks);
  if (!Number.isInteger(w) || w < 1 || w > 52) return { ok: false, code: "weeksInvalid" };
  if (!first_due || !/^\d{4}-\d{2}-\d{2}$/.test(first_due)) return { ok: false, code: "bad_date" };
  let loanP, intP, instP;
  try {
    loanP = toPaisa(loan);
    intP = toPaisa(interest);
    instP = toPaisa(instalment);
  } catch {
    return { ok: false, code: "bad_amount" };
  }
  if (loanP < 0 || intP < 0 || instP <= 0) return { ok: false, code: "bad_amount" };
  if (w * instP !== loanP + intP) return { ok: false, code: "planMismatch" };
  return {
    ok: true,
    record: {
      name: String(name).trim(),
      group,
      loan_bdt: fromPaisa(loanP),
      interest_bdt: fromPaisa(intP),
      plan_weeks: w,
      instalment_bdt: fromPaisa(instP),
      first_due,
      payments: [],
    },
  };
}

export function makeId(existing) {
  const n = existing.length + 1;
  return "B" + String(n).padStart(2, "0") + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
}

export function allocationLines(borrower, today, date, paisa) {
  const prev = previewAllocation(borrower, today, date, paisa);
  return {
    hits: prev.hits,
    extraSurplus: prev.extraSurplus,
    overdueAfter: prev.after.overduePaisa,
    text: prev.hits.map((h) => `W${h.week.k} +${fromPaisa(h.delta)}`).join(" → "),
  };
}

export function pickDefaultMember(snaps) {
  return snaps.find((s) => s.overduePaisa > 0) || snaps[0] || null;
}

export function nextOverdue(snaps, currentId) {
  const od = snaps.filter((s) => s.overduePaisa > 0 && s.id !== currentId);
  return od[0] || snaps.find((s) => s.id !== currentId) || snaps[0] || null;
}

function normalizeCase(c) {
  if (!c || typeof c !== "object") return null;
  if (!c.today || !/^\d{4}-\d{2}-\d{2}$/.test(c.today)) return null;
  if (!Array.isArray(c.borrowers) || c.borrowers.length < 1) return null;
  const borrowers = [];
  for (const b of c.borrowers) {
    if (!b || !b.id || !String(b.name || "").trim() || !b.group || !b.first_due) return null;
    let rec;
    try {
      rec = {
        id: String(b.id),
        name: String(b.name).trim(),
        group: String(b.group),
        loan_bdt: fromPaisa(toPaisa(b.loan_bdt)),
        interest_bdt: fromPaisa(toPaisa(b.interest_bdt)),
        plan_weeks: Number(b.plan_weeks),
        instalment_bdt: fromPaisa(toPaisa(b.instalment_bdt)),
        first_due: b.first_due,
        payments: (b.payments || []).map((p) => ({
          date: p.date,
          amount_bdt: String(p.amount_bdt),
        })),
      };
      snapshot(rec, c.today);
    } catch {
      return null;
    }
    borrowers.push(rec);
  }
  return { case_id: String(c.case_id || "CASE"), today: c.today, borrowers };
}

/** Accept official { cases: [...] } or a single case object. */
export function parseFixturePayload(data) {
  if (!data || typeof data !== "object") return { ok: false, code: "badFixture" };
  const rawCases = Array.isArray(data.cases) ? data.cases : [data];
  const cases = [];
  for (const c of rawCases) {
    const one = normalizeCase(c);
    if (!one) {
      if (!Array.isArray(data.cases)) return { ok: false, code: "badFixture" };
      continue;
    }
    cases.push(one);
  }
  if (!cases.length) return { ok: false, code: "badFixture" };
  return { ok: true, cases };
}

export function meetingClose(session, snaps) {
  const by = new Map();
  for (const x of session || []) {
    const cur = by.get(x.id) || { id: x.id, name: x.name, paisa: 0, n: 0 };
    cur.paisa += x.paisa;
    cur.n += 1;
    by.set(x.id, cur);
  }
  const paid = [...by.values()].sort((a, b) => b.paisa - a.paisa || a.name.localeCompare(b.name));
  const taken = paid.reduce((n, x) => n + x.paisa, 0);
  const still = snaps
    .filter((s) => s.overduePaisa > 0)
    .sort((a, b) => b.overduePaisa - a.overduePaisa || a.name.localeCompare(b.name));
  return { paid, taken, still, nPosts: (session || []).length };
}

export { snapshot, dashboard, previewAllocation };
