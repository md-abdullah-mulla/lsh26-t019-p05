export async function api(path, { method = "GET", body } = {}) {
  const r = await fetch("/api" + path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401) {
    const err = new Error("unauthorized");
    err.code = "unauthorized";
    err.status = 401;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(data.error || "api");
    err.code = data.code || "api";
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function apiHealth() {
  try {
    const r = await fetch("/api/health", { credentials: "include" });
    return r.ok;
  } catch {
    return false;
  }
}
