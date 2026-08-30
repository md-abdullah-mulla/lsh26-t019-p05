import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "./server/handler.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const persist = path.join(root, "data", "book.json");
const api = createHandler(persist);
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const clean = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(base, clean);
  if (!full.startsWith(base)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  if (url === "/api" || url.startsWith("/api/")) {
    await api(req, res);
    return;
  }
  let file = safeJoin(root, url === "/" ? "/index.html" : url);
  if (!file) {
    res.statusCode = 400;
    res.end("bad path");
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    res.setHeader("content-type", MIME[ext] || "application/octet-stream");
    res.setHeader("cache-control", ext === ".html" || ext === ".js" || ext === ".css" ? "no-store" : "public, max-age=60");
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`কিস্তি খাতা http://0.0.0.0:${PORT}`);
});
