/**
 * Deterministic micro-loan ledger.
 * Source of truth = payments. Schedule status is always derived.
 * As-of date is an input — never wall-clock.
 *
 * Allocation: oldest unpaid instalment first, leftover carries forward.
 */
import { toPaisa, fromPaisa, addDays, daysBetween } from "./money.js";

export function statusOf(week, today) {
  if (week.remainingPaisa === 0) return "paid";
  const part = week.paidPaisa > 0;
  if (week.due < today) return part ? "part_overdue" : "overdue";
  if (week.due === today) return part ? "part" : "due";
  return part ? "part" : "upcoming";
}

export function statusLabel(status) {
  switch (status) {
    case "paid": return "Paid";
    case "part": return "Part paid";
    case "part_overdue": return "Part · overdue";
    case "overdue": return "Overdue";
    case "due": return "Due today";
    case "upcoming": return "Upcoming";
    default: return status;
  }
}

/** Bucket used by the spec: paid / part paid / overdue (upcoming kept separate). */
export function statusBucket(status) {
  if (status === "paid") return "paid";
  if (status === "overdue" || status === "part_overdue") return "overdue";
  if (status === "part") return "part";
  return "other";
}

export function snapshot(borrower, today) {
  const loanPaisa = toPaisa(borrower.loan_bdt);
  const interestPaisa = toPaisa(borrower.interest_bdt);
  const instalmentPaisa = toPaisa(borrower.instalment_bdt);
  const facePaisa = loanPaisa + interestPaisa;
  const planWeeks = Number(borrower.plan_weeks);

  if (planWeeks * instalmentPaisa !== facePaisa) {
    throw new Error(
      `${borrower.id}: plan ${planWeeks} × ${instalmentPaisa} ≠ face ${facePaisa}`
    );
  }

  const weeks = [];
  for (let k = 1; k <= planWeeks; k++) {
    const due = addDays(borrower.first_due, 7 * (k - 1));
    weeks.push({
      k,
      due,
      duePaisa: instalmentPaisa,
      paidPaisa: 0,
      remainingPaisa: instalmentPaisa,
      allocations: [],
    });
  }

  const allPayments = (borrower.payments || []).map((p, seq) => ({
    date: p.date,
    amount_bdt: p.amount_bdt,
    seq,
    paisa: toPaisa(p.amount_bdt),
  }));

  // As-of: only payments dated on or before today are applied.
  const applied = allPayments
    .filter((p) => p.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));

  let surplusPaisa = 0;
  let collectedPaisa = 0;
  for (const p of applied) {
    collectedPaisa += p.paisa;
    let leftover = p.paisa;
    for (const w of weeks) {
      if (leftover <= 0) break;
      if (w.remainingPaisa <= 0) continue;
      const take = Math.min(leftover, w.remainingPaisa);
      w.paidPaisa += take;
      w.remainingPaisa -= take;
      leftover -= take;
      w.allocations.push({ date: p.date, paisa: take, seq: p.seq });
    }
    surplusPaisa += leftover;
  }

  for (const w of weeks) w.status = statusOf(w, today);

  let overduePaisa = 0;
  let overdueWeeks = 0;
  let oldestUnpaidDue = null;
  for (const w of weeks) {
    if (w.due < today && w.remainingPaisa > 0) {
      overduePaisa += w.remainingPaisa;
      overdueWeeks += 1;
      if (!oldestUnpaidDue) oldestUnpaidDue = w.due;
    }
  }

  const paidWeeks = weeks.filter((w) => w.remainingPaisa === 0).length;
  const remainingPaisa = weeks.reduce((s, w) => s + w.remainingPaisa, 0);
  const dueTodayPaisa = weeks
    .filter((w) => w.due === today)
    .reduce((s, w) => s + w.remainingPaisa, 0);

  const weeksBehindAge = oldestUnpaidDue
    ? Math.floor(daysBetween(oldestUnpaidDue, today) / 7)
    : 0;

  const nextOpen = weeks.find((w) => w.remainingPaisa > 0) || null;

  return {
    id: borrower.id,
    name: borrower.name,
    group: borrower.group,
    loanPaisa,
    interestPaisa,
    facePaisa,
    instalmentPaisa,
    planWeeks,
    firstDue: borrower.first_due,
    lastDue: weeks.length ? weeks[weeks.length - 1].due : borrower.first_due,
    collectedPaisa,
    surplusPaisa,
    remainingPaisa,
    overduePaisa,
    overdueWeeks,
    weeksBehindAge,
    oldestUnpaidDue,
    paidWeeks,
    dueTodayPaisa,
    nextOpen,
    weeks,
    appliedPayments: applied,
    futurePayments: allPayments.filter((p) => p.date > today),
    allPayments,
  };
}

export function previewAllocation(borrower, today, date, amountPaisa) {
  const ghost = {
    ...borrower,
    payments: [...(borrower.payments || []), { date, amount_bdt: (amountPaisa / 100).toFixed(2) }],
  };
  const before = snapshot(borrower, today);
  const after = snapshot(ghost, today);
  const hits = [];
  for (let i = 0; i < before.weeks.length; i++) {
    const delta = after.weeks[i].paidPaisa - before.weeks[i].paidPaisa;
    if (delta > 0) hits.push({ week: after.weeks[i], delta });
  }
  const extraSurplus = after.surplusPaisa - before.surplusPaisa;
  return { before, after, hits, extraSurplus };
}

export function dashboard(borrowers, today, group = null) {
  const scoped = group ? borrowers.filter((b) => b.group === group) : borrowers;
  const snaps = scoped.map((b) => snapshot(b, today));
  const given = snaps.reduce((s, x) => s + x.loanPaisa, 0);
  const interestBook = snaps.reduce((s, x) => s + x.interestPaisa, 0);
  const face = snaps.reduce((s, x) => s + x.facePaisa, 0);
  const collected = snaps.reduce((s, x) => s + x.collectedPaisa, 0);
  const overdue = snaps.reduce((s, x) => s + x.overduePaisa, 0);
  const remaining = snaps.reduce((s, x) => s + x.remainingPaisa, 0);
  const surplus = snaps.reduce((s, x) => s + x.surplusPaisa, 0);
  const overdueMembers = snaps.filter((x) => x.overduePaisa > 0).length;

  const byAmount = [...snaps]
    .filter((x) => x.overduePaisa > 0)
    .sort(
      (a, b) =>
        b.overduePaisa - a.overduePaisa ||
        b.overdueWeeks - a.overdueWeeks ||
        a.name.localeCompare(b.name)
    );

  const byWeeks = [...snaps]
    .filter((x) => x.overdueWeeks > 0)
    .sort(
      (a, b) =>
        b.overdueWeeks - a.overdueWeeks ||
        b.weeksBehindAge - a.weeksBehindAge ||
        b.overduePaisa - a.overduePaisa ||
        a.name.localeCompare(b.name)
    );

  const groups = {};
  for (const s of snaps) {
    if (!groups[s.group]) {
      groups[s.group] = { name: s.group, n: 0, given: 0, collected: 0, overdue: 0 };
    }
    const g = groups[s.group];
    g.n += 1;
    g.given += s.loanPaisa;
    g.collected += s.collectedPaisa;
    g.overdue += s.overduePaisa;
  }

  return {
    snaps,
    given,
    interestBook,
    face,
    collected,
    overdue,
    remaining,
    surplus,
    overdueMembers,
    collectionRate: face > 0 ? collected / face : 0,
    par: remaining > 0 ? overdue / remaining : 0,
    byAmount,
    byWeeks,
    groups: Object.values(groups).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Collection sheet for a chosen meeting date.
 * To collect = prior overdue (due < date) + remaining of the kisti due that day.
 * Due-today is not overdue, so it is added separately.
 */
export function collectionSheet(borrowers, sheetDate, group = null) {
  if (!sheetDate || !/^\d{4}-\d{2}-\d{2}$/.test(sheetDate)) {
    throw new Error("bad_date");
  }
  const scoped = group ? borrowers.filter((b) => b.group === group) : borrowers;
  const rows = scoped.map((b) => {
    const s = snapshot(b, sheetDate);
    const week = s.weeks.find((w) => w.due === sheetDate) || null;
    const dueThisWeekPaisa = week ? week.remainingPaisa : 0;
    const arrearsPaisa = s.overduePaisa;
    const toCollectPaisa = arrearsPaisa + dueThisWeekPaisa;
    const alreadyPaidOnDatePaisa = s.appliedPayments
      .filter((p) => p.date === sheetDate)
      .reduce((n, p) => n + p.paisa, 0);
    return {
      id: s.id,
      name: s.name,
      group: s.group,
      weekK: week ? week.k : null,
      instalmentPaisa: s.instalmentPaisa,
      dueThisWeekPaisa,
      arrearsPaisa,
      toCollectPaisa,
      alreadyPaidOnDatePaisa,
      overdueWeeks: s.overdueWeeks,
    };
  });
  rows.sort(
    (a, b) => b.toCollectPaisa - a.toCollectPaisa || a.name.localeCompare(b.name)
  );
  return {
    date: sheetDate,
    rows,
    totalToCollect: rows.reduce((n, r) => n + r.toCollectPaisa, 0),
    totalArrears: rows.reduce((n, r) => n + r.arrearsPaisa, 0),
    totalDueThisWeek: rows.reduce((n, r) => n + r.dueThisWeekPaisa, 0),
    alreadyPaid: rows.reduce((n, r) => n + r.alreadyPaidOnDatePaisa, 0),
    stillDue: rows.filter((r) => r.toCollectPaisa > 0).length,
  };
}

/** Finish date from actual collected / elapsed weeks, not the original plan. */
export function likelyFinishDate(snap, today) {
  if (!snap.remainingPaisa) return today;
  if (!snap.collectedPaisa) return snap.lastDue;
  const elapsedDays = Math.max(1, daysBetween(snap.firstDue, today));
  const elapsedWeeks = Math.max(1, Math.ceil(elapsedDays / 7));
  const avg = snap.collectedPaisa / elapsedWeeks;
  if (avg <= 0) return snap.lastDue;
  const weeksNeeded = Math.ceil(snap.remainingPaisa / avg);
  return addDays(today, 7 * weeksNeeded);
}

export function selfTest() {
  const b = {
    id: "X",
    name: "Test",
    group: "Shapla",
    loan_bdt: "1000.00",
    interest_bdt: "0.00",
    plan_weeks: 4,
    instalment_bdt: "250.00",
    first_due: "2026-08-01",
    payments: [
      { date: "2026-08-01", amount_bdt: "100" },
      { date: "2026-08-01", amount_bdt: "150" },
      { date: "2026-08-10", amount_bdt: "400" },
    ],
  };
  const s = snapshot(b, "2026-08-16");
  const checks = [
    s.weeks[0].remainingPaisa === 0,
    s.weeks[1].remainingPaisa === 0,
    s.weeks[2].paidPaisa === 15000,
    s.weeks[2].remainingPaisa === 10000,
    s.weeks[3].paidPaisa === 0,
    s.overduePaisa === 10000,
    s.overdueWeeks === 1,
    s.collectedPaisa === 65000,
    s.surplusPaisa === 0,
  ];
  // As-of 09 Aug: the 400 on 10 Aug has not happened yet.
  // W1 due 01 paid from the two 01 Aug posts; W2 due 08 still fully unpaid → overdue.
  const early = snapshot(b, "2026-08-09");
  checks.push(early.collectedPaisa === 25000);
  checks.push(early.weeks[0].remainingPaisa === 0);
  checks.push(early.weeks[1].remainingPaisa === 25000);
  checks.push(early.overduePaisa === 25000);
  checks.push(early.overdueWeeks === 1);
  checks.push(early.weeks[2].status === "upcoming");

  // future payment must not apply
  const withFuture = {
    ...b,
    payments: [...b.payments, { date: "2026-08-20", amount_bdt: "250" }],
  };
  const asOf16 = snapshot(withFuture, "2026-08-16");
  checks.push(asOf16.weeks[2].remainingPaisa === 10000);
  checks.push(asOf16.futurePayments.length === 1);

  if (checks.some((c) => !c)) {
    console.error("ledger self-test failed", checks);
    throw new Error("ledger self-test failed");
  }
  return true;
}
