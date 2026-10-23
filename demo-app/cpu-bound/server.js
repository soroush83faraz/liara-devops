/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Demo scenario "cpu-bound" (v2.3): healthy, except /report burns CPU in a synchronous loop for ~3 s per request
// (REPORT_MS overrides). No memory growth: the "slow, but not RAM" case. Plain Node, no dependencies, no outbound calls.
const http = require("node:http");

const SCENARIO = "cpu-bound";
const VERSION = "2.3.0";
const PORT = Number(process.env.PORT || 3000);

const PRODUCTS = [
  { id: 1, name: "دفتر یادداشت", price: 85000 },
  { id: 2, name: "خودکار آبی", price: 12000 },
  { id: 3, name: "کیف لپ‌تاپ", price: 640000 },
];

function page() {
  const cards = PRODUCTS.map((p) => `<div class="c"><h2>${p.name}</h2><p>${p.price.toLocaleString("fa-IR")} تومان</p></div>`).join("");
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فروشگاه نمونه</title><style>body{font-family:Tahoma,sans-serif;margin:0;background:#f6f8fa;color:#1a2433}header{background:#0f5f6b;color:#fff;padding:1.2rem}main{padding:1rem;display:grid;gap:.8rem;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}.c{background:#fff;border:1px solid #d8dee6;border-radius:8px;padding:1rem}</style></head><body><header><h1>فروشگاه نمونه</h1><p>نسخه ${VERSION}</p></header><main>${cards}</main></body></html>`;
}

function burnCpu(ms) {
  const end = Date.now() + ms;
  let x = 0;
  while (Date.now() < end) x = (x + Math.sqrt(Math.random() * 1e6)) % 1e9;
  return x;
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
  const path = (req.url || "/").split("?")[0];
  if (path === "/health") return send(res, 200, "application/json", JSON.stringify({ ok: true }));
  if (path === "/version") return send(res, 200, "application/json", JSON.stringify({ scenario: SCENARIO, version: VERSION }));
  if (path === "/report") {
    burnCpu(Number(process.env.REPORT_MS || 3000));
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ report: "ok" }));
  }
  if (path === "/products") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(PRODUCTS));
  if (path === "/") return send(res, 200, "text/html; charset=utf-8", page());
  return send(res, 404, "text/plain; charset=utf-8", "not found");
});

server.listen(PORT, "0.0.0.0", () => console.log(`Server listening on port ${server.address().port}`));
