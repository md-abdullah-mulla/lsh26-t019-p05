/** Integer-paisa money. Never use floats for ledger math. */

export function toPaisa(takaStr) {
  const raw = String(takaStr).trim().replace(/,/g, "");
  if (!raw) throw new Error("empty amount");
  const neg = raw[0] === "-";
  const s = neg ? raw.slice(1) : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error("amount must be taka with at most 2 decimals");
  }
  const [whole, frac = ""] = s.split(".");
  const paisa = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, "0"), 10);
  return neg ? -paisa : paisa;
}

export function fromPaisa(paisa) {
  const neg = paisa < 0;
  const p = Math.abs(Math.trunc(paisa));
  const whole = String(Math.floor(p / 100));
  const frac = String(p % 100).padStart(2, "0");
  return (neg ? "-" : "") + whole + "." + frac;
}

export function formatTaka(paisa) {
  const neg = paisa < 0;
  const p = Math.abs(Math.trunc(paisa));
  const whole = Math.floor(p / 100);
  const frac = String(p % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "−" : "") + grouped + "." + frac;
}

export function formatTakaCompact(paisa) {
  const n = Math.abs(paisa) / 100;
  if (n >= 100000) return (paisa < 0 ? "−" : "") + (n / 100000).toFixed(n >= 1000000 ? 1 : 2) + " lakh";
  return formatTaka(paisa);
}

export function normalizeTakaInput(raw) {
  const s = String(raw).trim().replace(/,/g, "");
  const paisa = toPaisa(s);
  return fromPaisa(paisa);
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];

export function formatDate(iso, lang = "en") {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const mon = lang === "bn" ? MON_BN : MON_EN;
  return `${d} ${mon[m - 1]} ${y}`;
}

export function formatDateShort(iso, lang = "en") {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const mon = lang === "bn" ? MON_BN : MON_EN;
  return `${d} ${mon[m - 1]}`;
}

export function daysBetween(a, b) {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  const da = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const db = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((db - da) / 86400000);
}
