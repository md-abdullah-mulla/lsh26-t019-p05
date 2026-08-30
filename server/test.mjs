import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store.mjs";
import { snapshot } from "../js/ledger.js";

const dir = mkdtempSync(join(tmpdir(), "kisti-"));
const store = createStore(join(dir, "book.json"));

function req(token) {
  return { headers: { cookie: token ? `kisti_session=${token}` : "" } };
}

let failed = 0;
function eq(a, b, msg) {
  if (a === b) return;
  failed += 1;
  console.error("FAIL", msg, "::", a, "!=", b);
}

try {
  store.getState(req(""));
  failed += 1;
  console.error("FAIL expected 401");
} catch (e) {
  eq(e.status, 401, "no cookie");
}

let bad = false;
try { store.login("", "2026"); } catch { bad = true; }
eq(bad, true, "empty name");

const { token, state } = store.login("Mina", "2026");
eq(state.officer, "Mina", "officer");
eq(state.borrowers.length >= 15, true, "seeded");
eq(!!token, true, "token");

const before = snapshot(state.borrowers.find((b) => b.id === "B01"), "2026-08-30").collectedPaisa;
const paid = store.pay(req(token), { id: "B01", date: "2026-08-30", amount: "375.50" });
const after = snapshot(paid.borrowers.find((b) => b.id === "B01"), "2026-08-30").collectedPaisa;
eq(after, before + 37550, "pay persisted");

const reset = store.reset(req(token));
eq(snapshot(reset.borrowers.find((b) => b.id === "B01"), "2026-08-30").collectedPaisa, before, "reset");

if (failed) {
  console.log(`server tests failed: ${failed}`);
  process.exit(1);
}
console.log("server tests passed");
