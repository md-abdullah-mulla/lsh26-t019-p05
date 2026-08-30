import { createStore } from "./store.mjs";

function send(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  };
  if (typeof res.status === "function" && res.status !== send) {
    // not used
  }
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

function cookieHeader(token, secure) {
  const parts = [
    `kisti_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=43200",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(secure) {
  const parts = ["kisti_session=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function isSecure(req) {
  const xf = String(req.headers["x-forwarded-proto"] || "");
  return xf.includes("https");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : c))).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function routeOf(req) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  let path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api") path = "/";
  else if (path.startsWith("/api/")) path = path.slice(4);
  return { method: (req.method || "GET").toUpperCase(), path, url };
}

export function createHandler(persistPath) {
  const store = createStore(persistPath);

  return async function handler(req, res) {
    const secure = isSecure(req);
    try {
      const { method, path } = routeOf(req);

      if (method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("allow", "GET,POST,PATCH,DELETE,OPTIONS");
        res.end();
        return;
      }

      if (method === "GET" && (path === "/health" || path === "/")) {
        send(res, 200, { ok: true, service: "kisti-khata" });
        return;
      }

      if (method === "POST" && path === "/login") {
        const body = await readBody(req);
        const out = store.login(body.name, body.pin);
        send(res, 200, out.state, { "set-cookie": cookieHeader(out.token, secure) });
        return;
      }

      if (method === "POST" && path === "/logout") {
        store.logout(req);
        send(res, 200, { ok: true }, { "set-cookie": clearCookie(secure) });
        return;
      }

      if (method === "GET" && path === "/state") {
        send(res, 200, store.getState(req));
        return;
      }

      if (method === "PATCH" && path === "/state") {
        const body = await readBody(req);
        send(res, 200, store.patchMeta(req, body));
        return;
      }

      if (method === "POST" && path === "/pay") {
        const body = await readBody(req);
        send(res, 200, store.pay(req, body));
        return;
      }

      if (method === "DELETE" && path === "/pay") {
        const body = await readBody(req);
        send(res, 200, store.unpay(req, body));
        return;
      }

      if (method === "POST" && path === "/borrowers") {
        const body = await readBody(req);
        send(res, 200, store.addBorrower(req, body));
        return;
      }

      if (method === "POST" && path === "/reset") {
        send(res, 200, store.reset(req));
        return;
      }

      if (method === "POST" && path === "/load-case") {
        const body = await readBody(req);
        send(res, 200, store.loadCase(req, body));
        return;
      }

      send(res, 404, { error: "not_found", code: "not_found" });
    } catch (e) {
      const status = e.status || (e.code === "unauthorized" ? 401 : 400);
      send(res, status, { error: e.message || "error", code: e.code || "error" });
    }
  };
}
