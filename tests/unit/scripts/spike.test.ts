import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSpikeCommand } from "../../../scripts/lib/spike-cli";
import { shapeOf } from "../../../scripts/lib/spike-shape";
import { collectIo } from "./fake-liara";

const TOKEN = "liara-token-ABCDEF1234567890";
const AI_KEY = "ai-key-ZYXWVU0987654321";
const LEAKS = [
  "acme-private-shop", "owner@example.com", "Sara Hosseini", "hunter2hunter2", "customer-private.ir", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
  "postgres://shop:dbpass9999@db.internal:5432/shop", "super-secret-session-value", "تولید ماهانه خصوصی", "10.20.30.40", "free-text-reason with spaces",
];
const nowSec = Math.floor(Date.now() / 1000);

function liaraBody(pathname: string): { status: number; body: unknown } {
  const ok = (body: unknown) => ({ status: 200, body });
  if (pathname === "/v1/me") {
    return ok({
      user: { _id: "u1", fullname: "Sara Hosseini", email: "owner@example.com", isTeam: false },
      databaseVersions: { postgres: [{ label: "16", value: "16" }] },
      plans: {
        projects: { "iran-g2-small": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5, price: 100 } },
        projectBundlePlans: {},
        databases: { "iran-g2-db": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 10, price: 200, supports: ["postgres"] } },
        databaseBundlePlans: {},
      },
    });
  }
  if (pathname === "/v1/billing") return ok({ user: { balance: 123456, accountType: "personal" } });
  if (pathname === "/v1/projects") return ok({ projects: [{ _id: "p1", project_id: "acme-private-shop", type: "node", status: "RUNNING", scale: 1, planID: "iran-g2-small", network: { _id: "n1", name: "acme-net" } }] });
  if (pathname === "/v1/projects/acme-private-shop") {
    return ok({ project: { project_id: "acme-private-shop", status: "RUNNING", scale: 1, isDeployed: true, envs: [{ key: "SESSION_SECRET", value: "super-secret-session-value" }, { key: "DB_URL", value: "postgres://shop:dbpass9999@db.internal:5432/shop" }], node: { IP: "10.20.30.40" } } });
  }
  if (pathname.endsWith("/applets")) return ok({ applets: [{ id: "a1", name: "acme-private-shop-7d9", state: "Running", reason: "free-text-reason with spaces", timestamp: "2026-01-01T00:00:00Z" }, { id: "a2", state: "CrashLoopBackOff", reason: "OOMKilled" }] });
  if (pathname.endsWith("/releases") && pathname.startsWith("/v1/projects/")) return ok({ currentRelease: "r1", releases: [{ _id: "r1", state: "READY", tag: "v3", imageName: "registry/acme-private-shop:3", sourceAvailable: true, createdAt: "2026-01-01T00:00:00Z", gitInfo: { message: "fix hunter2hunter2" } }] });
  if (pathname === "/v1/releases/r1") return ok({ release: { _id: "r1", state: "READY", queue: 0 } });
  if (pathname === "/v2/releases/r1/build-logs") return ok({ release: { _id: "r1", state: "READY" }, buildOutput: [{ _id: "b1", line: "password=hunter2hunter2", stream: "STDOUT", createdAt: "2026-01-01T00:00:00Z" }] });
  if (pathname.endsWith("/logs") && pathname.startsWith("/v2/")) return { status: 404, body: { message: "not found" } }; // v2 missing: exercise the fallback verdict
  if (pathname.endsWith("/logs") && pathname.startsWith("/v1/")) return ok([{ type: "stdout", datetime: "2026-01-01T00:00:00Z", message: "login by owner@example.com token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop" }]);
  if (pathname.endsWith("/events")) return ok({ data: [{ metaData: {}, values: [[`${nowSec}000000000`, "Killing container acme-private-shop"]] }] });
  if (pathname.endsWith("/metrics/summary")) return ok({ cpuUsage: [{ applet: "acme-private-shop-7d9", value: [nowSec, "0.12"] }], memoryUsage: [], disksUsage: [] });
  if (pathname.endsWith("/metrics/cpu")) return ok({ end: nowSec, result: [{ applet: "acme-private-shop-7d9", values: [[nowSec - 60, "0.10"], [nowSec, "0.12"]] }] });
  if (pathname === "/v1/domains") return ok({ domains: [{ _id: "d1", name: "customer-private.ir", status: "ACTIVE", certificatesStatus: "ACTIVE" }] });
  if (pathname === "/v1/domains/d1/check") return ok({ domain: { _id: "d1", name: "customer-private.ir", CNameRecord: "acme-private-shop.liara.run", verificationCode: "hunter2hunter2" } });
  if (pathname === "/v1/databases") return ok({ databases: [{ _id: "db1", hostname: "acme-db", type: "postgres", status: "RUNNING", scale: 1 }] });
  if (pathname === "/v1/databases/db1") return ok({ database: { hostname: "acme-db", status: "RUNNING", root_password: "hunter2hunter2", username: "owner@example.com" } });
  if (pathname === "/v1/networks") return ok({ networks: [{ _id: "n1", name: "acme-net", createdAt: "2026-01-01T00:00:00Z" }] });
  return { status: 404, body: { message: `unhandled ${pathname}` } };
}

function fakeFetch(calls: Array<{ method: string; url: string }>): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, url: String(input) });
    if (url.host === "ai.example.test") {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: "m1" }] });
      if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
      if (body.tools) return Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "get_time", arguments: "{}" } }] } }] });
      if (body.response_format) return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"ok":true}' } }] });
      return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok hunter2hunter2" } }], usage: { total_tokens: 5 } });
    }
    const { status, body } = liaraBody(url.pathname);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-ratelimit-remaining": "99" } });
  };
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "spike-test-"));
  dirs.push(d);
  return d;
};

describe("spike script", () => {
  it("performs only GETs (without --ai), writes a redacted report and never leaks user data or tokens", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const c = collectIo();
    const out = tmp();
    const code = await runSpikeCommand(["--out-dir", out, "--rate-probe", "3"], {
      env: { LIARA_API_TOKEN: TOKEN, LIARA_TEAM_ID: "team-xyz" },
      io: c.io,
      fetchImpl: fakeFetch(calls),
      now: new Date("2026-03-04T05:06:07Z"),
    });
    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.every((x) => x.method === "GET")).toBe(true);
    expect(calls.some((x) => x.url.includes("ai.example.test"))).toBe(false);

    const files = readdirSync(out);
    expect(files).toEqual(["spike-2026-03-04.json"]);
    const text = readFileSync(join(out, files[0]), "utf8");
    for (const leak of [...LEAKS, TOKEN, AI_KEY, "team-xyz"]) expect(text, `report leaks ${leak}`).not.toContain(leak);
    expect(c.text()).not.toContain(TOKEN);
    for (const leak of LEAKS) expect(c.text(), `console leaks ${leak}`).not.toContain(leak);

    const report = JSON.parse(text);
    expect(report.endpoints.projects.shape.projects._items).toHaveProperty("project_id", "string");
    expect(report.enums.appStatus).toEqual(["RUNNING"]);
    expect(report.enums.appletState).toEqual(["CrashLoopBackOff", "Running"]);
    expect(report.enums.releaseState).toEqual(["READY"]);
    expect(report.enums.dbStatus).toEqual(["RUNNING"]);
    expect(report.enums.domainCertificatesStatus).toEqual(["ACTIVE"]);
    expect(report.endpoints.metricsCpu_unix_seconds_1h_ago.shape.result._items.values._items).toEqual({ _tuple: ["number:unix-s", "string:numeric"] });
    expect(report.endpoints.databaseDetail.shape.database).toHaveProperty("root_password"); // key only; the final redaction pass masks the type too
    expect(report.counts).toMatchObject({ apps: 1, databases: 1, networks: 1, appsWithNetwork: 1, appPlans: 1, dbPlans: 1 });
    expect(report.ai).toBeUndefined();
  });

  it("maps results onto checklist items 1-13 with a what-this-changes hint for failures", async () => {
    const c = collectIo();
    const out = tmp();
    await runSpikeCommand(["--out-dir", out, "--rate-probe", "2"], { env: { LIARA_API_TOKEN: TOKEN }, io: c.io, fetchImpl: fakeFetch([]), now: new Date("2026-03-04T00:00:00Z") });
    const report = JSON.parse(readFileSync(join(out, "spike-2026-03-04.json"), "utf8"));
    const byItem = Object.fromEntries(report.checks.map((x: { item: number; outcome: string }) => [x.item, x.outcome]));
    expect(Object.keys(byItem).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(byItem).toMatchObject({ 1: "warn", 2: "pass", 3: "pass", 4: "skip", 5: "skip", 6: "pass", 7: "pass", 8: "pass", 9: "pass", 10: "skip", 11: "pass", 12: "pass", 13: "skip" });
    expect(report.checks.find((x: { item: number }) => x.item === 1).changes).toContain("falls back to v1");
    expect(c.text()).toMatch(/ 1 {2}WARN/);
    expect(c.text()).toContain("what this changes");
    expect(report.endpoints.runtimeLogsV2).toMatchObject({ ok: false, status: 404, kind: "not_found" });
    expect(report.enums.rateHeaders).toEqual(["x-ratelimit-remaining"]);
  });

  it("--ai runs the gateway probes and records no model output or key", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const out = tmp();
    const c = collectIo();
    const code = await runSpikeCommand(["--out-dir", out, "--ai"], {
      env: { LIARA_API_TOKEN: TOKEN, LIARA_AI_BASE_URL: "https://ai.example.test/api/ws1/v1", LIARA_AI_API_KEY: AI_KEY, LLM_MODEL: "test/model" },
      io: c.io,
      fetchImpl: fakeFetch(calls),
      now: new Date("2026-03-04T00:00:00Z"),
    });
    expect(code).toBe(0);
    const text = readFileSync(join(out, "spike-2026-03-04.json"), "utf8");
    const report = JSON.parse(text);
    expect(report.ai.map((r: { name: string; ok: boolean }) => [r.name, r.ok])).toEqual([
      ["base URL form: GET /models", true], ["chat completion", true], ["streaming (SSE)", true], ["tool call", true], ["json_schema output", true],
    ]);
    expect(report.checks.find((x: { item: number }) => x.item === 5).outcome).toBe("pass");
    for (const leak of [AI_KEY, "ws1", "hunter2hunter2"]) expect(text).not.toContain(leak);
    expect(calls.filter((x) => x.url.includes("ai.example.test")).length).toBe(5);
    expect(calls.filter((x) => !x.url.includes("ai.example.test")).every((x) => x.method === "GET")).toBe(true);
  });

  it("refuses without a token (2), without AI env for --ai (2), on bad flags (1) and on a rejected token (3)", async () => {
    const run = (argv: string[], env: Record<string, string>, fetchImpl?: typeof fetch) => runSpikeCommand(argv, { env, io: collectIo().io, fetchImpl });
    expect(await run([], {})).toBe(2);
    expect(await run(["--ai"], { LIARA_API_TOKEN: TOKEN })).toBe(2);
    expect(await run(["--rate-probe", "999"], { LIARA_API_TOKEN: TOKEN })).toBe(1);
    expect(await run(["--mutate"], { LIARA_API_TOKEN: TOKEN })).toBe(1);
    const out = tmp();
    expect(await run(["--out-dir", out], { LIARA_API_TOKEN: TOKEN }, async () => new Response("{}", { status: 401 }))).toBe(3);
  });
});

describe("shapeOf", () => {
  it("keeps keys, types and enum values only", () => {
    const s = shapeOf({ status: "RUNNING", note: "free text here", at: "2026-01-01T00:00:00Z", n: 3, ts: 1767225600, list: [{ state: "A" }, { state: "B", extra: true }], "weird key with spaces": 1 });
    expect(s).toEqual({
      status: { _enum: ["RUNNING"] },
      note: "string",
      at: "string:iso8601",
      n: "number",
      ts: "number:unix-s",
      list: { _len: 2, _items: { state: { _enum: ["A", "B"] }, extra: "boolean" } },
      "<key>": "number",
    });
  });

  it("does not record enum values that look like secrets or free text", () => {
    const s = shapeOf({ status: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", reason: "has spaces in it" });
    expect(s).toEqual({ status: "string", reason: "string" });
  });
});
