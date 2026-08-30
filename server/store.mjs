import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SEED } from "../js/seed.js";
import { snapshot } from "../js/ledger.js";
import {
  postToBorrower,
  removePayment,
  validateNewBorrower,
  makeId,
  checkOfficerLogin,
  parseFixturePayload,
} from "../js/actions.js";

const SESSION_MS = 12 * 60 * 60 * 1000;
const TODAY = "2026-08-30";
const COOKIE_KEY = process.env.KISTI_COOKIE_KEY || "kisti-khata-lsh26-t019-hmac";

function signOfficer(officer) {
  const payload = Buffer.from(JSON.stringify({ o: officer, e: Date.now() + SESSION_MS })).toString("base64url");
  const sig = createHmac("sha256", COOKIE_KEY).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyOfficer(token) {
  if (!token || !token.includes(".")) return null;
  const i = token.lastIndexOf(".");
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!payload || !sig) return null;
  const expect = createHmac("sha256", COOKIE_KEY).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.o || data.e < Date.now()) return null;
    return String(data.o);
  } catch {
    return null;
  }
}

function freshBook() {
  return {
    asOf: TODAY,
    group: "Shapla",
    lang: "bn",
    borrowers: structuredClone(SEED.borrowers),
    sessions: {},
  };
}

export function createStore(persistPath) {
  let db = freshBook();

  function loadDisk() {
    try {
      if (persistPath && existsSync(persistPath)) {
        const raw = JSON.parse(readFileSync(persistPath, "utf8"));
        if (raw && Array.isArray(raw.borrowers)) {
          db = {
            asOf: raw.asOf || TODAY,
            group: raw.group === undefined ? "Shapla" : raw.group,
            lang: raw.lang === "en" ? "en" : "bn",
            borrowers: raw.borrowers,
            sessions: raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {},
          };
        }
      }
    } catch {}
  }

  function persist() {
    if (!persistPath) return;
    try {
      mkdirSync(dirname(persistPath), { recursive: true });
      writeFileSync(persistPath, JSON.stringify(db));
    } catch {}
  }

  loadDisk();

  function publicState(officer) {
    return {
      officer,
      asOf: db.asOf,
      group: db.group,
      lang: db.lang,
      borrowers: db.borrowers,
    };
  }

  function tokenOf(req) {
    const cookie = String(req.headers?.cookie || "");
    const m = cookie.match(/(?:^|;\s*)kisti_session=([^;]+)/);
    if (m) return decodeURIComponent(m[1].trim());
    const auth = String(req.headers?.authorization || "");
    if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
    return "";
  }

  function sessionOfficer(token) {
    if (!token) return null;
    const signed = verifyOfficer(token);
    if (signed) return signed;
    const s = db.sessions[token];
    if (!s || s.exp < Date.now()) {
      if (s) delete db.sessions[token];
      return null;
    }
    return s.officer;
  }

  function requireOfficer(req) {
    const officer = sessionOfficer(tokenOf(req));
    if (!officer) {
      const err = new Error("unauthorized");
      err.code = "unauthorized";
      err.status = 401;
      throw err;
    }
    return officer;
  }

  function login(name, pin) {
    const v = checkOfficerLogin(name, pin);
    if (!v.ok) {
      const err = new Error(v.code);
      err.code = v.code;
      err.status = 400;
      throw err;
    }
    const token = signOfficer(v.officer);
    db.sessions[token] = { officer: v.officer, exp: Date.now() + SESSION_MS };
    persist();
    return { token, state: publicState(v.officer) };
  }

  function logout(req) {
    const token = tokenOf(req);
    if (token) delete db.sessions[token];
    persist();
  }

  function patchMeta(req, body) {
    const officer = requireOfficer(req);
    if (body.asOf) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.asOf)) {
        const err = new Error("bad_date");
        err.code = "bad_date";
        err.status = 400;
        throw err;
      }
      db.asOf = body.asOf;
    }
    if ("group" in body) db.group = body.group || null;
    if (body.lang === "bn" || body.lang === "en") db.lang = body.lang;
    persist();
    return publicState(officer);
  }

  function pay(req, body) {
    const officer = requireOfficer(req);
    const b = db.borrowers.find((x) => x.id === body.id);
    if (!b) {
      const err = new Error("not_found");
      err.code = "not_found";
      err.status = 404;
      throw err;
    }
    const posted = postToBorrower(b, body.date, body.amount);
    persist();
    return { ...publicState(officer), posted };
  }

  function unpay(req, body) {
    const officer = requireOfficer(req);
    const b = db.borrowers.find((x) => x.id === body.id);
    if (!b) {
      const err = new Error("not_found");
      err.code = "not_found";
      err.status = 404;
      throw err;
    }
    removePayment(b, Number(body.seq));
    persist();
    return publicState(officer);
  }

  function addBorrower(req, body) {
    const officer = requireOfficer(req);
    const v = validateNewBorrower(body);
    if (!v.ok) {
      const err = new Error(v.code);
      err.code = v.code;
      err.status = 400;
      throw err;
    }
    const rec = { ...v.record, id: makeId(db.borrowers) };
    snapshot(rec, db.asOf);
    db.borrowers.push(rec);
    persist();
    return { ...publicState(officer), createdId: rec.id };
  }

  function reset(req) {
    const officer = requireOfficer(req);
    const sessions = db.sessions;
    const lang = db.lang;
    db = freshBook();
    db.lang = lang;
    db.sessions = sessions;
    persist();
    return publicState(officer);
  }

  function loadCase(req, payload) {
    const officer = requireOfficer(req);
    const parsed = parseFixturePayload(payload);
    if (!parsed.ok) {
      const err = new Error("badFixture");
      err.code = "badFixture";
      err.status = 400;
      throw err;
    }
    const c = parsed.cases[0];
    db.asOf = c.today;
    db.group = null;
    db.borrowers = structuredClone(c.borrowers);
    persist();
    return { ...publicState(officer), caseId: c.case_id, cases: parsed.cases.map((x) => x.case_id) };
  }

  return {
    login,
    logout,
    requireOfficer,
    publicState,
    getState(req) {
      const officer = requireOfficer(req);
      return publicState(officer);
    },
    patchMeta,
    pay,
    unpay,
    addBorrower,
    reset,
    loadCase,
  };
}
