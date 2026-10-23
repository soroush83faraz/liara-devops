/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Demo scenario "memory-leak" (v2.4): /leak retains memory forever. Call it (or /leak?auto=1) until the container
// is OOM-killed on a small plan. Memory is Buffer-backed (off-heap) and touched, so the platform limit trips first.
const http = require("node:http");

const SCENARIO = "memory-leak";
const VERSION = "2.4.0";
const PORT = Number(process.env.PORT || 3000);
const MB = 1024 * 1024;

const retained = [];
let timer = null;

function leak(mb) {
  retained.push(Buffer.alloc(mb * MB, 1));
  return retained.length * mb;
}

function send(res, status, type, body) {
  res.setHeader("content-length", Buffer.byteLength(body));
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${ms.toFixed(1)} ms - ${res.getHeader("content-length") || 0}`);
  });
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  if (path === "/health") return send(res, 200, "application/json", JSON.stringify({ ok: true }));
  if (path === "/version") return send(res, 200, "application/json", JSON.stringify({ scenario: SCENARIO, version: VERSION }));
  if (path === "/leak") {
    const mb = Math.min(Math.max(Number(url.searchParams.get("mb")) || 32, 1), 256);
    if (url.searchParams.get("auto") && !timer) {
      timer = setInterval(() => console.log(`leaking: retained ~${leak(mb)} MB`), 500);
    }
    return send(res, 200, "application/json", JSON.stringify({ retainedMb: leak(mb), auto: Boolean(timer) }));
  }
  if (path === "/") return send(res, 200, "text/html; charset=utf-8", `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>فروشگاه نمونه</title></head><body><h1>فروشگاه نمونه</h1><p>نسخه ${VERSION}</p></body></html>`);
  return send(res, 404, "text/plain; charset=utf-8", "not found");
});

server.listen(PORT, "0.0.0.0", () => console.log(`Server listening on port ${server.address().port}`));
