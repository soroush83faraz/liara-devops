/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Demo scenario "crash-loop" (v2.2): starts fine, then throws an uncaught TypeError 2 s after boot and exits with
// code 1; the platform restarts it, so it loops. CRASH_AFTER_MS overrides the delay.
const http = require("node:http");

const SCENARIO = "crash-loop";
const VERSION = "2.2.0";
const PORT = Number(process.env.PORT || 3000);

function loadCart() {
  return undefined; // "forgot to initialise the cart"
}

function renderCartSummary() {
  const cart = loadCart();
  return cart.items.length;
}

function send(res, status, type, body) {
  res.setHeader("content-length", Buffer.byteLength(body));
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/health") return send(res, 200, "application/json", JSON.stringify({ ok: true }));
  if (path === "/version") return send(res, 200, "application/json", JSON.stringify({ scenario: SCENARIO, version: VERSION }));
  return send(res, 200, "text/html; charset=utf-8", `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>فروشگاه نمونه</title></head><body><h1>فروشگاه نمونه</h1></body></html>`);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${server.address().port}`);
  setTimeout(() => renderCartSummary(), Number(process.env.CRASH_AFTER_MS || 2000));
});
