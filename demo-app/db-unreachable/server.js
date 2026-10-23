/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Demo scenario "db-unreachable" (v2.6): every page first opens a TCP connection to DB_HOST:DB_PORT (default 5432).
// When that fails the page answers 500 and the Node error (ECONNREFUSED / ENOTFOUND / ETIMEDOUT) is logged.
// /health and /version stay 200. The only outbound traffic is that one TCP connect to the configured host.
const http = require("node:http");
const net = require("node:net");

const SCENARIO = "db-unreachable";
const VERSION = "2.6.0";
const PORT = Number(process.env.PORT || 3000);

function checkDatabase() {
  return new Promise((resolve, reject) => {
    const host = process.env.DB_HOST;
    const port = Number(process.env.DB_PORT || 5432);
    if (!host) return reject(new Error("DB_HOST is not set"));
    const socket = net.connect({ host, port });
    socket.setTimeout(3000, () => socket.destroy(new Error(`connect ETIMEDOUT ${host}:${port}`)));
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
  });
}

function send(res, status, type, body) {
  res.setHeader("content-length", Buffer.byteLength(body));
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${ms.toFixed(1)} ms - ${res.getHeader("content-length") || 0}`);
  });
  const path = (req.url || "/").split("?")[0];
  if (path === "/health") return send(res, 200, "application/json", JSON.stringify({ ok: true }));
  if (path === "/version") return send(res, 200, "application/json", JSON.stringify({ scenario: SCENARIO, version: VERSION }));
  try {
    await checkDatabase();
  } catch (err) {
    console.error(err.stack);
    return send(res, 500, "text/plain; charset=utf-8", "Internal Server Error");
  }
  return send(res, 200, "text/html; charset=utf-8", `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>فروشگاه نمونه</title></head><body><h1>فروشگاه نمونه</h1><p>نسخه ${VERSION}</p></body></html>`);
});

server.listen(PORT, "0.0.0.0", () => console.log(`Server listening on port ${server.address().port}`));
