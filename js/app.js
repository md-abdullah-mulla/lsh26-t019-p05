import { SEED } from "./seed.js";
import { fromPaisa, formatTaka, formatDate, formatDateShort } from "./money.js";
import { snapshot, dashboard, selfTest, collectionSheet, likelyFinishDate } from "./ledger.js";
import { I18N, GROUPS, STATUS_KEY, t as tr, groupName } from "./i18n.js";
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
  checkOfficerLogin,
} from "./actions.js";
import { api, setAuthToken } from "./api.js";

selfTest();

const TODAY_REAL = "2026-08-30";
const CASE_TODAY = SEED.today;
const NOTES = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25];
const FIXTURE_REMOTE = "https://live.hackathon.lofistack.com/api/fixtures/P05?teamId=LSH26-T019";
const FIXTURE_LOCAL = "./data/P05_micro_loans_public.json";

function loadLang() {
  try {
    const s = localStorage.getItem("kisti-lang");
    if (s === "en" || s === "bn") return s;
  } catch {}
  return "bn";
}

let state = {
  asOf: TODAY_REAL,
  borrowers: [],
  group: "Shapla",
  lang: loadLang(),
  officer: null,
};
let view = {
  page: "meeting",
  memberId: null,
  q: "",
  modal: null,
  toast: null,
  amountStr: "",
  payDate: null,
  receipt: null,
  session: [],
  whatIf: 50,
  formError: null,
  sheetDate: null,
  cases: null,
  caseId: SEED.case_id || "PUB-01",
};

function t(key) { return tr(state.lang, key); }
function g(name) { return groupName(state.lang, name); }
function taka(p) { return "৳" + formatTaka(p); }
function fd(iso) { return formatDate(iso, state.lang); }
function fds(iso) { return formatDateShort(iso, state.lang); }
function find(id) { return state.borrowers.find((b) => b.id === id); }
function applyBook(data) {
  if (!data) return;
  state.officer = data.officer || null;
  state.asOf = data.asOf || state.asOf;
  state.group = data.group === undefined ? state.group : data.group;
  if (data.lang === "bn" || data.lang === "en") state.lang = data.lang;
  if (Array.isArray(data.borrowers)) state.borrowers = data.borrowers;
  saveLang();
}
function saveLang() {
  try { localStorage.setItem("kisti-lang", state.lang); } catch {}
}
async function pullState() {
  try {
    applyBook(await api("/state"));
    return true;
  } catch (e) {
    if (e && e.code === "unauthorized") state.officer = null;
    return false;
  }
}
function save() { saveLang(); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function st(status) { return t(STATUS_KEY[status] || status); }
function toast(msg) {
  view.toast = msg;
  render();
  setTimeout(() => { if (view.toast === msg) { view.toast = null; render(); } }, 2500);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function dash() { return dashboard(state.borrowers, state.asOf, state.group); }
function sheetDate() { return view.sheetDate || state.asOf; }
function groupsInBook() {
  const seen = new Set(state.borrowers.map((b) => b.group));
  const extra = [...seen].filter((x) => !GROUPS.includes(x)).sort();
  return GROUPS.filter((x) => seen.has(x)).concat(extra);
}

function showPayError(msg) {
  view.formError = msg;
  const box = document.getElementById("pay-err");
  if (box) {
    box.hidden = false;
    box.textContent = msg;
  } else {
    render();
  }
}

function loginHtml() {
  return `
    <div class="login-wrap">
      <form class="box login-card form" id="login-form">
        <div class="brand">${esc(t("brand"))}</div>
        <p class="place">${esc(t("place"))}</p>
        <h1>${esc(t("loginTitle"))}</h1>
        <p class="help">${esc(t("loginSub"))}</p>
        <div class="lang">
          <button type="button" data-lang="bn" class="${state.lang === "bn" ? "on" : ""}">${esc(t("langBn"))}</button>
          <button type="button" data-lang="en" class="${state.lang === "en" ? "on" : ""}">${esc(t("langEn"))}</button>
        </div>
        <label>${esc(t("loginName"))}</label>
        <input id="login-name" name="officer" autocomplete="username" required />
        <label>${esc(t("loginPin"))}</label>
        <input id="login-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required />
        <div class="errbox" id="login-err" hidden></div>
        <p class="help">${esc(t("loginHelp"))}</p>
        <button class="btn primary" type="submit">${esc(t("loginGo"))}</button>
      </form>
    </div>
  `;
}

function bindLogin() {
  document.querySelectorAll("[data-lang]").forEach((el) => {
    el.addEventListener("click", () => { state.lang = el.dataset.lang; save(); render(); });
  });
  document.getElementById("login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("login-name")?.value || "";
    const pin = document.getElementById("login-pin")?.value || "";
    const box = document.getElementById("login-err");
    try {
      applyBook(await api("/login", { method: "POST", body: { name, pin } }));
      view.page = "meeting";
      render();
    } catch (err) {
      if (box) {
        box.hidden = false;
        box.textContent = t(err.code === "unauthorized" || err.code === "api" ? "serverDown" : (err.code || "loginBad"));
      }
    }
  });
  document.getElementById("login-name")?.focus();
}

function render() {
  document.documentElement.lang = state.lang === "bn" ? "bn" : "en";
  const root = document.getElementById("app");
  if (!state.officer) {
    root.innerHTML = loginHtml();
    bindLogin();
    return;
  }
  const d = dash();
  root.innerHTML = `
    <header class="top">
      <div class="brand">${esc(t("brand"))}</div>
      <div class="place">${esc(t("place"))}</div>
      <nav class="nav">
        <button data-nav="meeting" class="${view.page === "meeting" ? "on" : ""}">${esc(t("navMeeting"))}</button>
        <button data-nav="sheet" class="${view.page === "sheet" ? "on" : ""}">${esc(t("navSheet"))}</button>
        <button data-nav="dash" class="${view.page === "dash" ? "on" : ""}">${esc(t("navBook"))}</button>
        <button data-nav="members" class="${view.page === "members" || view.page === "member" ? "on" : ""}">${esc(t("navMembers"))}</button>
        <button data-nav="about" class="${view.page === "about" ? "on" : ""}">${esc(t("navAbout"))}</button>
      </nav>
      <div class="tools">
        <label>${esc(t("asOf"))}
          <input type="date" id="asof" value="${esc(state.asOf)}" />
        </label>
        <button type="button" data-asof="${TODAY_REAL}" class="${state.asOf === TODAY_REAL ? "on" : ""}">${esc(t("todayChip"))}</button>
        <button type="button" data-asof="${CASE_TODAY}" class="${state.asOf === CASE_TODAY ? "on" : ""}">${esc(t("caseChip"))}</button>
        <div class="lang">
          <button type="button" data-lang="bn" class="${state.lang === "bn" ? "on" : ""}">${esc(t("langBn"))}</button>
          <button type="button" data-lang="en" class="${state.lang === "en" ? "on" : ""}">${esc(t("langEn"))}</button>
        </div>
        <span class="officer-chip" title="${esc(t("loggedInAs"))}">${esc(t("loggedInAs"))}: ${esc(state.officer)}</span>
        <button type="button" id="logout">${esc(t("logout"))}</button>
      </div>
    </header>
    <div class="subbar">
      <button data-group="" class="${!state.group ? "on" : ""}">${esc(t("groupAll"))} (${state.borrowers.length})</button>
      ${groupsInBook().map((x) => {
        const n = state.borrowers.filter((b) => b.group === x).length;
        return `<button data-group="${x}" class="${state.group === x ? "on" : ""}"><i class="dot ${x}"></i>${esc(g(x))} (${n})</button>`;
      }).join("")}
      <span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" id="new-b">${esc(t("newMember"))}</button>
      </span>
    </div>
    <main class="wrap">${pageHtml(d)}</main>
    ${view.modal === "borrower" ? borrowerModal() : ""}
    ${view.modal === "close" ? closeModal(d) : ""}
    ${view.receipt ? receiptModal(view.receipt) : ""}
    ${view.toast ? `<div class="toast">${esc(view.toast)}</div>` : ""}
  `;
  bind();
  paintLive();
}

function pageHtml(d) {
  if (view.page === "member") return memberHtml();
  if (view.page === "members") return membersHtml(d);
  if (view.page === "about") return aboutHtml(d);
  if (view.page === "dash") return bookHtml(d);
  if (view.page === "sheet") return sheetHtml();
  return meetingHtml(d);
}

function meetingHtml(d) {
  const snaps = [...d.snaps].sort((a, b) => b.overduePaisa - a.overduePaisa || a.name.localeCompare(b.name));
  if (!view.memberId || !snaps.some((s) => s.id === view.memberId)) {
    view.memberId = pickDefaultMember(snaps)?.id || null;
  }
  const b = view.memberId ? find(view.memberId) : null;
  const s = b ? snapshot(b, state.asOf) : null;
  const sessionSum = view.session.reduce((n, x) => n + x.paisa, 0);
  const title = state.group ? g(state.group) : t("groupAll");
  return `
    <div class="hrow">
      <div>
        <h1>${esc(title)}</h1>
        <p class="help">${esc(t("meetingHelp"))} ${d.overdueMembers} ${esc(t("inArrears"))}. ${esc(t("sessionTaken"))}: ${taka(sessionSum)}</p>
      </div>
      <div class="sheet-actions no-print">
        <span class="kbd">${esc(t("keysHint"))}</span>
        <button type="button" class="btn" data-nav="sheet">${esc(t("openSheet"))}</button>
        <button type="button" class="btn primary" id="close-meeting" style="width:auto">${esc(t("closeMeeting"))}</button>
      </div>
    </div>
    <div class="meet">
      <div class="box">
        <h2>${esc(t("queue"))}</h2>
        ${snaps.length ? snaps.map((m) => `
          <div class="seat ${m.id === view.memberId ? "on" : ""}" data-select="${esc(m.id)}">
            <div>
              <div class="nm">${esc(m.name)}</div>
              <div class="sm">${weekStrip(m)} ${m.overdueWeeks ? m.overdueWeeks + " " + t("weeksBehind") : t("current")}</div>
            </div>
            <div class="${m.overduePaisa ? "warn" : ""}">${m.overduePaisa ? taka(m.overduePaisa) : "—"}</div>
          </div>`).join("") : `<div class="empty">${esc(t("emptyBook"))}</div>`}
      </div>
      ${s ? payForm(b, s) : `<div class="box"><div class="empty">${esc(t("emptyBook"))}</div></div>`}
    </div>
  `;
}

function payForm(b, s) {
  const date = view.payDate || state.asOf;
  const finish = likelyFinishDate(s, state.asOf);
  return `
    <div class="box form" id="pay-box">
      <h2>${esc(s.name)} · ${esc(s.id)} · ${esc(g(s.group))}</h2>
      <div style="padding:10px 12px">
        <div class="sm">${s.paidWeeks}/${s.planWeeks} ${esc(t("closedWeeks"))} · ${esc(t("overdue"))} ${taka(s.overduePaisa)} · ${esc(t("finishDate"))} ${fd(finish)}</div>
        <label>${esc(t("date"))}</label>
        <input type="date" id="pay-date" value="${esc(date)}" />
        <label>${esc(t("amount"))}</label>
        <input type="text" id="pay-amt" inputmode="decimal" placeholder="750.50" value="${esc(view.amountStr)}" />
        <div class="cash" id="cash-show">${taka(safePaisa(view.amountStr))}</div>
        <div class="errbox" id="pay-err" ${view.formError ? "" : "hidden"}>${esc(view.formError || "")}</div>
        <div class="pad">
          ${NOTES.map((n) => `<button type="button" data-add="${n}">${n >= 100 ? n / 100 : fromPaisa(n)}</button>`).join("")}
          <button type="button" data-add="0">${esc(t("clear"))}</button>
        </div>
        <div class="quick">
          ${s.nextOpen ? `<button type="button" data-set="${fromPaisa(s.nextOpen.remainingPaisa)}">${esc(t("gap"))}</button>` : ""}
          <button type="button" data-set="${fromPaisa(s.instalmentPaisa)}">${esc(t("oneKisti"))}</button>
          <button type="button" data-set="${fromPaisa(Math.floor(s.instalmentPaisa / 2))}">${esc(t("half"))}</button>
          ${s.overduePaisa ? `<button type="button" data-set="${fromPaisa(s.overduePaisa)}">${esc(t("arrears"))}</button>` : ""}
        </div>
        <p class="help" style="margin:0">${esc(t("customHint"))} ${esc(t("waterfallHint"))}</p>
        <div class="preview" id="pay-preview"></div>
        <div id="weekbars"></div>
        <button type="button" class="btn primary" id="post-pay">${esc(t("post"))}</button>
        <div class="quick">
          <button type="button" data-open="${esc(s.id)}">${esc(t("passbook"))}</button>
        </div>
      </div>
    </div>
  `;
}

function sheetHtml() {
  const date = sheetDate();
  let sheet;
  try { sheet = collectionSheet(state.borrowers, date, state.group); }
  catch { sheet = { rows: [], totalToCollect: 0, totalArrears: 0, totalDueThisWeek: 0, alreadyPaid: 0, stillDue: 0, date }; }
  const title = state.group ? g(state.group) : t("groupAll");
  return `
    <div class="hrow">
      <div>
        <h1>${esc(t("navSheet"))} · ${esc(title)}</h1>
        <p class="help">${esc(t("sheetHelp"))}</p>
      </div>
    </div>
    <div class="sheet-actions no-print">
      <label>${esc(t("weekDate"))} <input type="date" id="sheet-date" value="${esc(date)}" /></label>
      <button type="button" class="btn" id="print-sheet">${esc(t("printSheet"))}</button>
      <button type="button" class="btn" id="csv-sheet">${esc(t("downloadCsv"))}</button>
      <span class="kbd">${sheet.stillDue} ${esc(t("nMembers"))} · ${esc(t("toCollect"))} ${taka(sheet.totalToCollect)}</span>
    </div>
    <section class="kpis">
      <article class="kpi"><div class="lbl">${esc(t("toCollect"))}</div><div class="val">${taka(sheet.totalToCollect)}</div><div class="hint">${sheet.stillDue} ${esc(t("nMembers"))}</div></article>
      <article class="kpi warn"><div class="lbl">${esc(t("arrearsCol"))}</div><div class="val">${taka(sheet.totalArrears)}</div></article>
      <article class="kpi"><div class="lbl">${esc(t("dueThisWeek"))}</div><div class="val">${taka(sheet.totalDueThisWeek)}</div></article>
      <article class="kpi"><div class="lbl">${esc(t("paidOnDate"))}</div><div class="val">${taka(sheet.alreadyPaid)}</div></article>
    </section>
    <div class="box" id="sheet-table" style="overflow:auto">
      <h2>${esc(t("printTitle"))} · ${fd(date)}</h2>
      ${sheet.rows.length ? `<table>
        <thead><tr>
          <th>${esc(t("name"))}</th><th>${esc(t("group"))}</th><th>${esc(t("weekNo"))}</th>
          <th class="num">${esc(t("dueThisWeek"))}</th><th class="num">${esc(t("arrearsCol"))}</th>
          <th class="num">${esc(t("toCollect"))}</th><th class="num">${esc(t("paidOnDate"))}</th>
        </tr></thead>
        <tbody>${sheet.rows.map((r) => `
          <tr data-open="${esc(r.id)}">
            <td>${esc(r.name)}<div class="meta">${esc(r.id)}</div></td>
            <td><i class="dot ${esc(r.group)}"></i>${esc(g(r.group))}</td>
            <td>${r.weekK != null ? r.weekK : esc(t("noneThisWeek"))}</td>
            <td class="num">${r.dueThisWeekPaisa ? taka(r.dueThisWeekPaisa) : "—"}</td>
            <td class="num ${r.arrearsPaisa ? "warn" : ""}">${r.arrearsPaisa ? taka(r.arrearsPaisa) : "—"}</td>
            <td class="num">${r.toCollectPaisa ? taka(r.toCollectPaisa) : "—"}</td>
            <td class="num">${r.alreadyPaidOnDatePaisa ? taka(r.alreadyPaidOnDatePaisa) : "—"}</td>
          </tr>`).join("")}
          <tr>
            <td colspan="3"><strong>${esc(t("total"))}</strong></td>
            <td class="num"><strong>${taka(sheet.totalDueThisWeek)}</strong></td>
            <td class="num"><strong>${taka(sheet.totalArrears)}</strong></td>
            <td class="num"><strong>${taka(sheet.totalToCollect)}</strong></td>
            <td class="num"><strong>${taka(sheet.alreadyPaid)}</strong></td>
          </tr>
        </tbody>
      </table>` : `<div class="empty">${esc(t("sheetEmpty"))}</div>`}
    </div>
  `;
}

function bookHtml(d) {
  const w = whatIf(d.overdue, d.remaining, view.whatIf);
  const title = state.group ? g(state.group) : t("groupAll");
  return `
    <div class="hrow">
      <div>
        <h1>${esc(title)}</h1>
        <p class="help">${esc(t("bookHelp"))} ${fd(state.asOf)}</p>
      </div>
    </div>
    <section class="kpis">
      <article class="kpi"><div class="lbl">${esc(t("given"))}</div><div class="val">${taka(d.given)}</div><div class="hint">${esc(t("principal"))} · ${esc(t("interest"))} ${taka(d.interestBook)}</div></article>
      <article class="kpi"><div class="lbl">${esc(t("collected"))}</div><div class="val">${taka(d.collected)}</div><div class="hint">${Math.round(d.collectionRate * 1000) / 10}% ${esc(t("ofFace"))} ${taka(d.face)}</div></article>
      <article class="kpi warn"><div class="lbl">${esc(t("overdue"))}</div><div class="val">${taka(d.overdue)}</div><div class="hint">${d.overdueMembers} ${esc(t("inArrears"))} · ${esc(t("parNow"))} ${pct(d.par)}</div></article>
      <article class="kpi"><div class="lbl">${esc(t("remaining"))}</div><div class="val">${taka(d.remaining)}</div><div class="hint">${esc(t("surplus"))} ${taka(d.surplus)}</div></article>
    </section>
    <section class="two">
      <article class="box">
        <h2>${esc(t("byAmount"))}</h2>
        ${rankList(d.byAmount.slice(0, 8), (s) => taka(s.overduePaisa), (s) => s.overdueWeeks + " " + t("weeksBehind"))}
      </article>
      <article class="box">
        <h2>${esc(t("byWeeks"))}</h2>
        ${rankList(d.byWeeks.slice(0, 8), (s) => s.overdueWeeks + " " + t("weeksBehind"), (s) => taka(s.overduePaisa))}
      </article>
    </section>
    <article class="box" style="margin-bottom:12px">
      <h2>${esc(t("whatIf"))}</h2>
      <div style="padding:10px 12px">
        <input id="whatif" type="range" min="0" max="100" step="5" value="${view.whatIf}" />
        <div><strong>${view.whatIf}%</strong> → ${taka(w.lifted)} · ${esc(t("parNow"))} ${pct(w.oldPar)} → ${esc(t("parThen"))} ${pct(w.newPar)} · ${esc(t("overdue"))} ${taka(w.newOd)}</div>
      </div>
    </article>
    ${membersTable(d.snaps)}
  `;
}

function pct(x) { return (Math.round(x * 1000) / 10) + "%"; }

function rankList(rows, primary, secondary) {
  if (!rows.length) return `<div class="empty">${esc(t("noneOverdue"))}</div>`;
  return `<ol class="rank">${rows.map((s) => `
    <li data-open="${esc(s.id)}">
      <span><div class="who">${esc(s.name)}</div><div class="meta">${esc(g(s.group))} · ${esc(s.id)} · ${secondary(s)}</div></span>
      <span>${primary(s)}</span>
    </li>`).join("")}</ol>`;
}

function membersHtml(d) {
  const q = view.q.trim().toLowerCase();
  const snaps = q ? d.snaps.filter((s) => (s.name + s.id + s.group).toLowerCase().includes(q)) : d.snaps;
  return `
    <div class="hrow"><h1>${esc(t("navMembers"))}</h1></div>
    <div class="search"><input id="q" placeholder="${esc(t("searchPh"))}" value="${esc(view.q)}" /></div>
    ${membersTable(snaps)}
  `;
}

function membersTable(snaps) {
  const sorted = [...snaps].sort((a, b) => b.overduePaisa - a.overduePaisa || a.name.localeCompare(b.name));
  return `<div class="box" style="overflow:auto"><table>
    <thead><tr>
      <th>${esc(t("name"))}</th><th>${esc(t("group"))}</th><th></th>
      <th class="num">${esc(t("given"))}</th><th class="num">${esc(t("collected"))}</th>
      <th class="num">${esc(t("overdue"))}</th><th>${esc(t("weeksBehind"))}</th>
    </tr></thead>
    <tbody>${sorted.map((s) => `
      <tr data-open="${esc(s.id)}">
        <td>${esc(s.name)}<div class="meta">${esc(s.id)} · ${s.paidWeeks}/${s.planWeeks}</div></td>
        <td><i class="dot ${esc(s.group)}"></i>${esc(g(s.group))}</td>
        <td>${weekStrip(s)}</td>
        <td class="num">${taka(s.loanPaisa)}</td>
        <td class="num">${taka(s.collectedPaisa)}</td>
        <td class="num ${s.overduePaisa ? "warn" : ""}">${s.overduePaisa ? taka(s.overduePaisa) : "—"}</td>
        <td>${s.overdueWeeks ? `<span class="badge overdue">${s.overdueWeeks}</span>` : `<span class="badge paid">${esc(t("current"))}</span>`}</td>
      </tr>`).join("") || `<tr><td colspan="7">${esc(t("emptyBook"))}</td></tr>`}
    </tbody>
  </table></div>`;
}

function weekStrip(s) {
  return `<div class="strip">${s.weeks.map((w) => `<i class="${w.status}"></i>`).join("")}</div>`;
}

function memberHtml() {
  const b = find(view.memberId);
  if (!b) return `<p>${esc(t("emptyBook"))}</p>`;
  const s = snapshot(b, state.asOf);
  const finish = likelyFinishDate(s, state.asOf);
  return `
    <p><button class="btn" data-nav="meeting">← ${esc(t("navMeeting"))}</button></p>
    <div class="hrow">
      <div>
        <h1>${esc(s.name)}</h1>
        <p class="help">${esc(s.id)} · ${esc(g(s.group))} · ${fd(s.firstDue)} → ${fd(s.lastDue)} · ${esc(t("face"))} ${taka(s.facePaisa)} · ${esc(t("finishDate"))} ${fd(finish)} <span class="meta">(${esc(t("basedOnPay"))})</span></p>
      </div>
    </div>
    <div class="facts">
      <div><div class="k">${esc(t("collected"))}</div><div class="v">${taka(s.collectedPaisa)}</div></div>
      <div><div class="k">${esc(t("overdue"))}</div><div class="v ${s.overduePaisa ? "warn" : ""}">${taka(s.overduePaisa)}</div></div>
      <div><div class="k">${esc(t("weeksBehind"))}</div><div class="v ${s.overdueWeeks ? "warn" : ""}">${s.overdueWeeks}</div></div>
    </div>
    <div class="meet">
      ${payForm(b, s)}
      <div>
        <div id="weekbars-side"></div>
        <div class="box">
          <h2>${esc(t("passbook"))}</h2>
          <table>
            <thead><tr>
              <th>${esc(t("week"))}</th><th>${esc(t("due"))}</th>
              <th class="num">${esc(t("due"))}</th><th class="num">${esc(t("paid"))}</th>
              <th class="num">${esc(t("left"))}</th><th>${esc(t("status"))}</th>
            </tr></thead>
            <tbody>${s.weeks.map((w) => `
              <tr>
                <td>${w.k}</td><td>${fd(w.due)}</td>
                <td class="num">${formatTaka(w.duePaisa)}</td>
                <td class="num">${formatTaka(w.paidPaisa)}</td>
                <td class="num">${formatTaka(w.remainingPaisa)}</td>
                <td><span class="badge ${w.status}">${esc(st(w.status))}</span></td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
        <div class="box" style="margin-top:12px">
          <h2>${esc(t("paymentLog"))}</h2>
          ${s.allPayments.length ? `<table>
            <tbody>${s.allPayments.map((p) => `
              <tr>
                <td>${p.seq + 1}</td>
                <td>${fd(p.date)}</td>
                <td class="num">${taka(p.paisa)}</td>
                <td>${p.date > state.asOf ? esc(t("afterAsOf")) : esc(t("applied"))}</td>
                <td><button class="btn danger" data-del-pay="${p.seq}">${esc(t("remove"))}</button></td>
              </tr>`).join("")}</tbody>
          </table>` : `<div class="empty">${esc(t("noPayments"))}</div>`}
        </div>
      </div>
    </div>
  `;
}

function barsHtml(b, paisa) {
  const s = snapshot(b, state.asOf);
  let leftover = Math.max(0, paisa);
  return `<div class="bars">${s.weeks.map((w) => {
    const incoming = leftover > 0 ? Math.min(leftover, w.remainingPaisa) : 0;
    leftover -= incoming;
    const base = (w.paidPaisa / w.duePaisa) * 100;
    const extra = (incoming / w.duePaisa) * 100;
    return `<div class="bar ${w.status}" title="${st(w.status)}">
      <div class="n">${w.k} ${fds(w.due)}</div>
      <div class="track">
        <span class="fill" style="width:${base}%"></span>
        <span class="in" style="left:${base}%;width:${extra}%"></span>
      </div>
    </div>`;
  }).join("")}</div>`;
}

function previewText(b, paisa) {
  if (!paisa) return t("waterfallHint");
  try {
    const lines = allocationLines(b, state.asOf, view.payDate || state.asOf, paisa);
    const date = view.payDate || state.asOf;
    if (date > state.asOf) return t("afterAsOf");
    const extra = lines.extraSurplus ? ` · ${t("surplus")} ${formatTaka(lines.extraSurplus)}` : "";
    return (lines.text || "—") + extra + ` · ${t("thenOverdue")} ${formatTaka(lines.overdueAfter)}`;
  } catch (e) {
    return e.message;
  }
}

function aboutHtml(d) {
  const top = d.byWeeks[0];
  return `
    <h1>${esc(t("navAbout"))}</h1>
    <p class="help">${esc(t("tagline"))} · ${esc(t("place"))}</p>
    <div class="about">
      <p>1. ${esc(t("about1"))}</p>
      <p>2. ${esc(t("about2"))}</p>
      <p>3. ${esc(t("about3"))}</p>
      <p>${esc(t("fixtureHelp"))}</p>
    </div>
    <div class="sheet-actions no-print" style="margin:14px 0">
      <button type="button" class="btn" id="load-official">${esc(t("loadOfficial"))}</button>
      <button type="button" class="btn" id="load-local">${esc(t("loadLocal"))}</button>
      <button type="button" class="btn" id="upload-json">${esc(t("fileBtn"))}</button>
      <button type="button" class="btn" id="reset">${esc(t("reset"))}</button>
      <input type="file" id="fixture-file" class="hidden-file" accept="application/json,.json" />
      ${view.cases ? `<label>${esc(t("pickCase"))}
        <select id="case-pick">${view.cases.map((c) => `<option value="${esc(c.case_id)}" ${c.case_id === view.caseId ? "selected" : ""}>${esc(c.case_id)}</option>`).join("")}</select>
      </label>` : ""}
    </div>
    ${top ? `<p>${esc(top.name)} · ${top.overdueWeeks} ${esc(t("weeksBehind"))} · ${taka(top.overduePaisa)}
      <button class="btn" data-open="${esc(top.id)}">${esc(t("passbook"))}</button></p>` : ""}
  `;
}

function borrowerModal() {
  return `<div class="modal-bg" id="modal">
    <form class="modal form" id="new-form">
      <h2>${esc(t("newMember"))}</h2>
      <div class="errbox" id="new-err" hidden></div>
      <div class="grid2">
        <div><label>${esc(t("name"))}</label><input name="name" required /></div>
        <div><label>${esc(t("group"))}</label>
          <select name="group">${groupsInBook().map((x) => `<option value="${x}">${esc(g(x))}</option>`).join("")}</select>
        </div>
        <div><label>${esc(t("loan"))}</label><input name="loan" required /></div>
        <div><label>${esc(t("interest"))}</label><input name="interest" required /></div>
        <div><label>${esc(t("weeks"))}</label><input name="weeks" required type="number" min="1" max="52" value="10" /></div>
        <div><label>${esc(t("instalment"))}</label><input name="instalment" required /></div>
        <div><label>${esc(t("firstDue"))}</label><input name="first_due" type="date" required value="${esc(state.asOf)}" /></div>
      </div>
      <p class="help">${esc(t("planMismatch"))}</p>
      <div class="modal-actions">
        <button type="button" class="btn" id="cancel-modal">${esc(t("cancel"))}</button>
        <button class="btn primary" type="submit">${esc(t("create"))}</button>
      </div>
    </form>
  </div>`;
}

function closeModal(d) {
  const c = meetingClose(view.session, d.snaps);
  const expected = (() => {
    try { return collectionSheet(state.borrowers, state.asOf, state.group).totalToCollect; }
    catch { return 0; }
  })();
  return `<div class="modal-bg" id="close-bg">
    <div class="modal" style="width:min(720px,100%)">
      <h2>${esc(t("closingTitle"))}</h2>
      <p class="help">${esc(t("closeHint"))} ${fd(state.asOf)}</p>
      <section class="kpis">
        <article class="kpi"><div class="lbl">${esc(t("sessionCash"))}</div><div class="val">${taka(c.taken)}</div><div class="hint">${c.nPosts} · ${esc(t("taken"))}</div></article>
        <article class="kpi"><div class="lbl">${esc(t("expected"))}</div><div class="val">${taka(expected)}</div></article>
        <article class="kpi warn"><div class="lbl">${esc(t("leftOverdue"))}</div><div class="val">${taka(d.overdue)}</div><div class="hint">${c.still.length} ${esc(t("inArrears"))}</div></article>
      </section>
      <div class="close-grid">
        <div class="box">
          <h2>${esc(t("whoPaid"))}</h2>
          ${c.paid.length ? `<ol class="rank">${c.paid.map((p) => `<li><span class="who">${esc(p.name)}</span><span>${taka(p.paisa)}</span></li>`).join("")}</ol>` : `<div class="empty">${esc(t("noSession"))}</div>`}
        </div>
        <div class="box">
          <h2>${esc(t("whoLeft"))}</h2>
          ${c.still.length ? `<ol class="rank">${c.still.slice(0, 8).map((s) => `<li data-open="${esc(s.id)}"><span class="who">${esc(s.name)}</span><span class="warn">${taka(s.overduePaisa)}</span></li>`).join("")}</ol>` : `<div class="empty">${esc(t("noneOverdue"))}</div>`}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="cancel-close">${esc(t("close"))}</button>
        <button class="btn" id="print-close">${esc(t("printClose"))}</button>
        <button class="btn primary" data-nav="sheet">${esc(t("openSheet"))}</button>
      </div>
    </div>
  </div>`;
}

function receiptModal(r) {
  return `<div class="modal-bg" id="receipt-bg">
    <div class="modal">
      <h2>${esc(t("receiptTitle"))}</h2>
      <p>${esc(t("postedFor"))} <strong>${esc(r.name)}</strong> · ${esc(r.id)}</p>
      <p>${fd(r.date)} · ${taka(r.paisa)}</p>
      <p>${esc(r.lines)}</p>
      <p>${esc(t("thenOverdue"))}: ${taka(r.overdueAfter)}</p>
      <p class="kbd">${esc(t("keysHint"))}</p>
      <div class="modal-actions">
        <button class="btn" id="close-receipt">${esc(t("close"))}</button>
        <button class="btn primary" id="next-member">${esc(t("nextMember"))}</button>
      </div>
    </div>
  </div>`;
}

function safePaisa(str) {
  try { return parseAmountToPaisa(str); } catch { return 0; }
}

function paintLive() {
  const b = view.memberId ? find(view.memberId) : null;
  const paisa = safePaisa(view.amountStr);
  const show = document.getElementById("cash-show");
  if (show) show.textContent = taka(paisa);
  const prev = document.getElementById("pay-preview");
  if (prev && b) prev.textContent = previewText(b, paisa);
  if (!b) return;
  const html = barsHtml(b, paisa);
  const wb = document.getElementById("weekbars");
  if (wb) wb.innerHTML = html;
}

function goNextMember() {
  view.receipt = null;
  view.formError = null;
  const nxt = nextOverdue(dash().snaps, view.memberId);
  if (nxt) view.memberId = nxt.id;
  view.amountStr = "";
  view.page = "meeting";
  render();
  document.getElementById("pay-amt")?.focus();
}

function bind() {
  document.getElementById("asof")?.addEventListener("change", async (e) => {
    try { applyBook(await api("/state", { method: "PATCH", body: { asOf: e.target.value } })); }
    catch { state.asOf = e.target.value; }
    render();
  });
  document.querySelectorAll("[data-asof]").forEach((el) => {
    el.addEventListener("click", async () => {
      try { applyBook(await api("/state", { method: "PATCH", body: { asOf: el.dataset.asof } })); }
      catch { state.asOf = el.dataset.asof; }
      render();
    });
  });
  document.querySelectorAll("[data-lang]").forEach((el) => {
    el.addEventListener("click", async () => {
      state.lang = el.dataset.lang;
      saveLang();
      if (state.officer) {
        try { applyBook(await api("/state", { method: "PATCH", body: { lang: state.lang } })); } catch {}
      }
      render();
    });
  });
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      view.page = el.dataset.nav;
      view.receipt = null;
      view.modal = null;
      view.formError = null;
      render();
    });
  });
  document.querySelectorAll("[data-group]").forEach((el) => {
    el.addEventListener("click", async () => {
      const group = el.dataset.group || null;
      view.memberId = null; view.amountStr = ""; view.formError = null;
      try { applyBook(await api("/state", { method: "PATCH", body: { group } })); }
      catch { state.group = group; }
      render();
    });
  });
  document.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => {
      view.page = "member"; view.memberId = el.dataset.open; view.amountStr = "";
      view.modal = null; view.receipt = null; view.formError = null; render();
    });
  });
  document.querySelectorAll("[data-select]").forEach((el) => {
    el.addEventListener("click", () => {
      view.memberId = el.dataset.select; view.amountStr = ""; view.formError = null; render();
    });
  });
  document.getElementById("reset")?.addEventListener("click", async () => {
    if (!confirm(t("resetConfirm"))) return;
    try {
      applyBook(await api("/reset", { method: "POST", body: {} }));
      view = { ...view, session: [], amountStr: "", memberId: null, page: "meeting", receipt: null, formError: null, caseId: SEED.case_id || "PUB-01", sheetDate: null };
      toast(t("restored"));
    } catch {
      toast(t("serverDown"));
    }
    render();
  });
  document.getElementById("logout")?.addEventListener("click", async () => {
    try { await api("/logout", { method: "POST", body: {} }); } catch {}
    setAuthToken("");
    state.officer = null;
    state.borrowers = [];
    render();
  });
  document.getElementById("demo")?.addEventListener("click", playDemo);
  document.getElementById("new-b")?.addEventListener("click", () => { view.modal = "borrower"; render(); });
  document.getElementById("cancel-modal")?.addEventListener("click", () => { view.modal = null; render(); });
  document.getElementById("modal")?.addEventListener("click", (e) => {
    if (e.target.id === "modal") { view.modal = null; render(); }
  });
  document.getElementById("close-receipt")?.addEventListener("click", () => { view.receipt = null; render(); });
  document.getElementById("receipt-bg")?.addEventListener("click", (e) => {
    if (e.target.id === "receipt-bg") { view.receipt = null; render(); }
  });
  document.getElementById("next-member")?.addEventListener("click", goNextMember);
  document.getElementById("close-meeting")?.addEventListener("click", () => { view.modal = "close"; render(); });
  document.getElementById("cancel-close")?.addEventListener("click", () => { view.modal = null; render(); });
  document.getElementById("close-bg")?.addEventListener("click", (e) => {
    if (e.target.id === "close-bg") { view.modal = null; render(); }
  });
  document.getElementById("print-close")?.addEventListener("click", printClosing);
  document.getElementById("print-sheet")?.addEventListener("click", printSheet);
  document.getElementById("csv-sheet")?.addEventListener("click", downloadSheetCsv);
  document.getElementById("sheet-date")?.addEventListener("change", (e) => {
    view.sheetDate = e.target.value; render();
  });
  document.getElementById("load-official")?.addEventListener("click", () => loadFixtures());
  document.getElementById("load-local")?.addEventListener("click", () => loadFixtures(true));
  document.getElementById("upload-json")?.addEventListener("click", () => document.getElementById("fixture-file")?.click());
  document.getElementById("fixture-file")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) readFixtureFile(file);
  });
  document.getElementById("case-pick")?.addEventListener("change", (e) => {
    const c = (view.cases || []).find((x) => x.case_id === e.target.value);
    if (c) applyCase(c);
  });
  document.getElementById("q")?.addEventListener("input", (e) => {
    view.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = document.getElementById("q");
    if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  });
  document.getElementById("whatif")?.addEventListener("input", (e) => {
    view.whatIf = Number(e.target.value);
    render();
  });

  const amt = document.getElementById("pay-amt");
  const dateEl = document.getElementById("pay-date");
  amt?.addEventListener("input", () => {
    view.amountStr = amt.value;
    view.formError = null;
    const box = document.getElementById("pay-err");
    if (box) { box.hidden = true; box.textContent = ""; }
    paintLive();
  });
  amt?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doPost(); }
  });
  dateEl?.addEventListener("input", () => {
    view.payDate = dateEl.value;
    paintLive();
  });
  document.querySelectorAll("[data-add]").forEach((el) => {
    el.addEventListener("click", () => {
      const n = Number(el.dataset.add);
      let cur = 0;
      try { cur = parseAmountToPaisa(view.amountStr); } catch { cur = 0; }
      const next = n === 0 ? 0 : cur + n;
      view.amountStr = next ? fromPaisa(next) : "";
      if (amt) amt.value = view.amountStr;
      view.formError = null;
      paintLive();
    });
  });
  document.querySelectorAll("[data-set]").forEach((el) => {
    el.addEventListener("click", () => {
      view.amountStr = el.dataset.set;
      if (amt) amt.value = view.amountStr;
      view.formError = null;
      paintLive();
    });
  });
  document.getElementById("post-pay")?.addEventListener("click", () => {
    doPost();
  });
  document.querySelectorAll("[data-del-pay]").forEach((el) => {
    el.addEventListener("click", async () => {
      if (!confirm(t("confirmRemove"))) return;
      try {
        applyBook(await api("/pay", { method: "DELETE", body: { id: view.memberId, seq: Number(el.dataset.delPay) } }));
        render();
      } catch {
        showPayError(t("confirmRemove"));
      }
    });
  });
  document.getElementById("new-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get("name"),
      group: fd.get("group"),
      loan: fd.get("loan"),
      interest: fd.get("interest"),
      weeks: fd.get("weeks"),
      instalment: fd.get("instalment"),
      first_due: fd.get("first_due"),
    };
    const v = validateNewBorrower(body);
    if (!v.ok) {
      const msg = t(v.code === "bad_date" ? "alertDate" : v.code === "bad_amount" ? "alertAmount" : v.code);
      const box = document.getElementById("new-err");
      if (box) { box.hidden = false; box.textContent = msg; }
      return;
    }
    try {
      const out = await api("/borrowers", { method: "POST", body });
      applyBook(out);
      view.modal = null;
      view.page = "member";
      view.memberId = out.createdId;
      render();
    } catch (err) {
      const box = document.getElementById("new-err");
      if (box) { box.hidden = false; box.textContent = t(err.code || "serverDown"); }
    }
  });
}

async function doPost() {
  const b = find(view.memberId);
  if (!b) return;
  const date = document.getElementById("pay-date")?.value || view.payDate || state.asOf;
  view.payDate = date;
  try {
    const paisa = parseAmountToPaisa(view.amountStr);
    if (!paisa) {
      showPayError(t("alertAmount"));
      document.getElementById("pay-amt")?.focus();
      return;
    }
    const lines = allocationLines(b, state.asOf, date, paisa);
    const out = await api("/pay", { method: "POST", body: { id: b.id, date, amount: view.amountStr } });
    applyBook(out);
    view.session.push({ id: b.id, name: b.name, paisa: out.posted.paisa });
    view.amountStr = "";
    view.formError = null;
    view.receipt = {
      id: b.id,
      name: b.name,
      date,
      paisa: out.posted.paisa,
      lines: lines.text,
      overdueAfter: lines.overdueAfter,
    };
    render();
  } catch (e) {
    showPayError(
      e.code === "bad_date" ? t("alertDate")
        : e.code === "unauthorized" ? t("sessionGone")
        : e.code === "serverDown" || e.code === "api" ? t("serverDown")
        : t("alertAmount")
    );
    document.getElementById("pay-amt")?.focus();
  }
}

async function applyCase(c) {
  try {
    const out = await api("/load-case", { method: "POST", body: c });
    applyBook(out);
    view.caseId = out.caseId || c.case_id;
    view.session = [];
    view.memberId = null;
    view.amountStr = "";
    view.receipt = null;
    view.sheetDate = c.today;
    view.formError = null;
    view.page = "meeting";
    render();
  } catch {
    toast(t("serverDown"));
  }
}

async function loadFixtures(preferLocal = false) {
  toast(t("loading"));
  const urls = preferLocal ? [FIXTURE_LOCAL, FIXTURE_REMOTE] : [FIXTURE_REMOTE, FIXTURE_LOCAL];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const parsed = parseFixturePayload(data);
      if (!parsed.ok) continue;
      view.cases = parsed.cases;
      await applyCase(parsed.cases[0]);
      toast(t("loadOk") + " " + parsed.cases[0].case_id);
      return;
    } catch {}
  }
  toast(t("loadFail"));
}

function readFixtureFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseFixturePayload(JSON.parse(String(reader.result)));
      if (!parsed.ok) { toast(t("badFixture")); return; }
      view.cases = parsed.cases;
      applyCase(parsed.cases[0]);
      toast(t("loadOk") + " " + parsed.cases[0].case_id);
    } catch {
      toast(t("loadFail"));
    }
  };
  reader.readAsText(file);
}

function currentSheet() {
  return collectionSheet(state.borrowers, sheetDate(), state.group);
}

function sheetCsv(sheet) {
  const header = ["id", "name", "group", "week", "due_this_week_bdt", "arrears_bdt", "to_collect_bdt", "paid_that_day_bdt"];
  const lines = [header];
  for (const r of sheet.rows) {
    lines.push([
      r.id, r.name, r.group, r.weekK ?? "",
      fromPaisa(r.dueThisWeekPaisa), fromPaisa(r.arrearsPaisa),
      fromPaisa(r.toCollectPaisa), fromPaisa(r.alreadyPaidOnDatePaisa),
    ]);
  }
  return "\uFEFF" + lines.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function downloadSheetCsv() {
  const sheet = currentSheet();
  const blob = new Blob([sheetCsv(sheet)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kisti-sheet-${sheet.date}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function printHtml(title, body) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>
      body{font-family:"Segoe UI","Noto Sans Bengali",sans-serif;color:#122;padding:18px}
      table{border-collapse:collapse;width:100%;font-size:12px}
      th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}
      td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
      h1{font-size:18px;margin:0 0 4px}
      .muted{color:#555;margin:0 0 12px;font-size:13px}
      .sum{display:flex;gap:18px;margin:0 0 12px;font-weight:700}
    </style></head><body>${body}</body></html>`);
  doc.close();
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  setTimeout(() => iframe.remove(), 1500);
}

function printSheet() {
  const sheet = currentSheet();
  const title = t("printTitle");
  const rows = sheet.rows.map((r) => `<tr>
    <td>${esc(r.name)} (${esc(r.id)})</td>
    <td>${esc(g(r.group))}</td>
    <td>${r.weekK != null ? r.weekK : "—"}</td>
    <td class="num">${fromPaisa(r.dueThisWeekPaisa)}</td>
    <td class="num">${fromPaisa(r.arrearsPaisa)}</td>
    <td class="num">${fromPaisa(r.toCollectPaisa)}</td>
    <td></td>
  </tr>`).join("");
  printHtml(title, `
    <h1>${esc(title)}</h1>
    <p class="muted">${esc(t("place"))} · ${fd(sheet.date)} · ${esc(state.group ? g(state.group) : t("groupAll"))}</p>
    <div class="sum"><span>${esc(t("toCollect"))} ${taka(sheet.totalToCollect)}</span><span>${esc(t("arrearsCol"))} ${taka(sheet.totalArrears)}</span></div>
    <table><thead><tr>
      <th>${esc(t("name"))}</th><th>${esc(t("group"))}</th><th>${esc(t("weekNo"))}</th>
      <th class="num">${esc(t("dueThisWeek"))}</th><th class="num">${esc(t("arrearsCol"))}</th>
      <th class="num">${esc(t("toCollect"))}</th><th>${esc(t("paidOnDate"))}</th>
    </tr></thead><tbody>${rows}
      <tr><td colspan="3"><strong>${esc(t("total"))}</strong></td>
        <td class="num"><strong>${fromPaisa(sheet.totalDueThisWeek)}</strong></td>
        <td class="num"><strong>${fromPaisa(sheet.totalArrears)}</strong></td>
        <td class="num"><strong>${fromPaisa(sheet.totalToCollect)}</strong></td>
        <td></td></tr>
    </tbody></table>`);
}

function printClosing() {
  const d = dash();
  const c = meetingClose(view.session, d.snaps);
  const paid = c.paid.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${fromPaisa(p.paisa)}</td></tr>`).join("");
  const still = c.still.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${fromPaisa(s.overduePaisa)}</td></tr>`).join("");
  printHtml(t("closingTitle"), `
    <h1>${esc(t("closingTitle"))}</h1>
    <p class="muted">${esc(t("place"))} · ${fd(state.asOf)}</p>
    <div class="sum"><span>${esc(t("sessionCash"))} ${taka(c.taken)}</span><span>${esc(t("leftOverdue"))} ${taka(d.overdue)}</span></div>
    <h2>${esc(t("whoPaid"))}</h2>
    <table><tbody>${paid || `<tr><td>${esc(t("noSession"))}</td></tr>`}</tbody></table>
    <h2>${esc(t("whoLeft"))}</h2>
    <table><tbody>${still || `<tr><td>${esc(t("noneOverdue"))}</td></tr>`}</tbody></table>`);
}

async function playDemo() {
  try {
    applyBook(await api("/state", { method: "PATCH", body: { asOf: CASE_TODAY, group: "Shapla" } }));
  } catch {
    state.asOf = CASE_TODAY;
    state.group = "Shapla";
  }
  view.page = "meeting";
  view.memberId = "B13";
  view.amountStr = "";
  view.receipt = null;
  view.formError = null;
  render();
  toast(t("demoStart"));
  await sleep(900);
  const b = find("B13");
  if (!b) return;
  const s = snapshot(b, state.asOf);
  view.amountStr = fromPaisa(s.overduePaisa);
  view.payDate = state.asOf;
  paintLive();
  const amt = document.getElementById("pay-amt");
  if (amt) amt.value = view.amountStr;
  toast(t("demoFill"));
  await sleep(1400);
  doPost();
}

window.addEventListener("keydown", (e) => {
  if (!state.officer) return;
  if (e.key === "Escape") {
    if (view.receipt || view.modal) {
      view.receipt = null;
      view.modal = null;
      render();
    }
    return;
  }
  if (view.receipt && (e.key === "Enter" || e.key === "n" || e.key === "N")) {
    e.preventDefault();
    goNextMember();
    return;
  }
  if (e.target.matches?.("input, textarea, select")) return;
  if (e.key === "d" || e.key === "D") playDemo();
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    goNextMember();
  }
  if (e.key === "Enter" && (view.page === "meeting" || view.page === "member")) {
    e.preventDefault();
    doPost();
  }
});

export const __test = { I18N, t, stateRef: () => state };

(async function boot() {
  render();
  await pullState();
  render();
})();
