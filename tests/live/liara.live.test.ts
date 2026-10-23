/**
 * Live validation of the plan §2 checklist (items 1-13).
 *
 *   LIARA_API_TOKEN=...            enables the read-only tests (suite is skipped without it)
 *   LIARA_TEAM_ID=...              optional team
 *   LIARA_TEST_APP=my-test-app     app used by reads; the ONLY app mutating tests may touch
 *   ALLOW_BILLED_LIVE_TESTS=1      additionally enables tests that create/mutate/bill
 *   LIARA_TEST_DOMAIN=...          domain the mutating domain test may add to / remove from LIARA_TEST_APP
 *   LIARA_AI_BASE_URL / LIARA_AI_API_KEY / LIARA_AI_MODEL   item 5 (AI gateway)
 *
 * Every test prints a keys-only shape summary ("[live] ...") and never values.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  addDomain, applyEnvOps, checkDomain, createApp, createRelease, databaseRef, getApp, getAppEvents, getAppMetricSeries,
  getAppMetricsSummary, getBuildLogs, getDatabase, getDatabaseCredentials, getMe, getRelease, getRuntimeLogs, isLiaraError,
  listAppPlans, listApplets, listApps, listDatabases, listDbPlans, listDbVersions, listDomains, listNetworks, listReleases,
  normalizeSeries, parseRuntimeLogs, removeDomain, watchRelease, type LiaraClient,
} from "../../lib/liara";
import { ALLOW_BILLED, distinct, HAS_TOKEN, liveClient, pickReadApp, report, shape, TEAM_ID, TEST_APP, TOKEN } from "./helpers";

const T = { timeout: 120_000 };
const reads = describe.skipIf(!HAS_TOKEN);
const canMutate = HAS_TOKEN && ALLOW_BILLED && TEST_APP !== "";

reads("Liara live: read-only checklist", T, () => {
  const client: LiaraClient = liveClient();

  it("1. runtime logs: v2 shape, v1 fallback", async () => {
    const app = await pickReadApp(client);
    if (!app) return report("1 runtime logs", "no apps on the account: nothing to validate");
    const startSec = Math.floor(Date.now() / 1000) - 3600;
    const v2 = await client
      .get(`/v2/projects/${encodeURIComponent(app)}/logs`, z.unknown(), { query: { start: startSec, direction: "forward", last_lines: false } })
      .then((raw) => ({ ok: true as const, raw }), (e) => ({ ok: false as const, kind: isLiaraError(e) ? e.kind : "other", status: isLiaraError(e) ? e.status : 0 }));
    report("1 v2 raw", v2.ok ? shape(v2.raw) : v2);
    const res = await getRuntimeLogs(client, app, { startSec });
    report("1 parsed", { source: res.source, lines: res.lines.length, streams: [...new Set(res.lines.map((l) => l.stream))], sample: res.lines[0] ? shape(res.lines[0]) : null });
    expect(["v1", "v2"]).toContain(res.source);
    for (const l of res.lines) expect(Number.isNaN(Date.parse(l.ts))).toBe(false);
    if (v2.ok) expect(parseRuntimeLogs(v2.raw).length).toBe(res.source === "v2" ? res.lines.length : parseRuntimeLogs(v2.raw).length);
  });

  it("2. release detail + build-logs accept the API key", async () => {
    const app = await pickReadApp(client);
    if (!app) return;
    const page = await listReleases(client, app, { count: 5 });
    report("2 releases list", shape(page));
    const id = page.releases[0]?._id;
    if (!id) return report("2", "app has no releases");
    const rel = await getRelease(client, id);
    report("2 release detail [CLI endpoint]", shape(rel));
    expect(typeof rel.state).toBe("string");
    const logs = await getBuildLogs(client, id);
    report("2 build-logs [CLI endpoint]", shape(logs));
    expect(Array.isArray(logs.buildOutput)).toBe(true);
  });

  it("3. metrics: summary and `since` unit/shape", async () => {
    const app = await pickReadApp(client);
    if (!app) return;
    const summary = await getAppMetricsSummary(client, app);
    report("3 summary", shape(summary));
    const now = Math.floor(Date.now() / 1000);
    const candidates = { unix_seconds_1h_ago: now - 3600, relative_seconds_3600: 3600, unix_ms_1h_ago: (now - 3600) * 1000 };
    const outcome: Record<string, unknown> = {};
    let worked = 0;
    for (const [name, since] of Object.entries(candidates)) {
      try {
        const s = await getAppMetricSeries(client, app, "cpu", since);
        const pts = normalizeSeries(s).flatMap((x) => x.points);
        outcome[name] = { ok: true, series: s.result.length, points: pts.length, shape: shape(s, 3) };
        worked++;
      } catch (e) {
        outcome[name] = { ok: false, kind: isLiaraError(e) ? e.kind : "other", status: isLiaraError(e) ? e.status : 0 };
      }
    }
    report("3 `since` candidates", outcome);
    expect(worked).toBeGreaterThan(0);
  });

  it("6. GET /v1/me: plan shapes and normalisers", async () => {
    const me = await getMe(client);
    report("6 me", shape(me, 3));
    const firstProject = Object.values(me.plans?.projects ?? {})[0];
    const firstDb = Object.values(me.plans?.databases ?? {})[0];
    report("6 raw plan shapes", { project: shape(firstProject), db: shape(firstDb), bundle: shape(Object.values(me.plans?.projectBundlePlans ?? {})[0]) });
    const appPlans = listAppPlans(me);
    const dbPlans = listDbPlans(me);
    report("6 normalised", { appPlans: appPlans.length, dbPlans: dbPlans.length, engines: listDbVersions(me).map((v) => v.engine) });
    expect(appPlans.length + dbPlans.length).toBeGreaterThan(0);
    for (const p of [...appPlans, ...dbPlans]) expect(Number.isFinite(p.pricePerMonth)).toBe(true);
  });

  it("7. databases: list and detail (password never in the default type)", async (ctx) => {
    const dbs = await listDatabases(client);
    report("7 list", shape(dbs));
    const first = dbs[0];
    if (!first) return ctx.skip();
    const ref = databaseRef(first);
    expect(ref).toBeTruthy();
    const detail = await getDatabase(client, ref!);
    report("7 detail (no password)", shape(detail));
    expect("root_password" in detail).toBe(false);
    const creds = await getDatabaseCredentials(client, ref!);
    report("7 credentials present?", { hasPassword: Boolean(creds.password), hasUsername: Boolean(creds.username), hasInternalPort: creds.internalPort !== undefined });
  });

  it("8. networks list and `network` on apps", async () => {
    const networks = await listNetworks(client);
    report("8 networks", shape(networks));
    const apps = await listApps(client);
    report("8 apps network field", { appsWithNetwork: apps.filter((a) => a.network).length, total: apps.length, sample: shape(apps.find((a) => a.network)?.network) });
    expect(Array.isArray(networks)).toBe(true);
  });

  it("9. domains: list and check record values (read-only part)", async (ctx) => {
    const app = await pickReadApp(client);
    if (!app) return ctx.skip();
    const domains = await listDomains(client, app);
    report("9 domains list", shape(domains));
    const d = domains[0]?._id;
    if (!d) return ctx.skip();
    const checked = await checkDomain(client, d);
    report("9 check", { shape: shape(checked), hasCNameRecord: Boolean(checked.CNameRecord), hasVerificationCode: Boolean(checked.verificationCode) });
  });

  it("11. status enums seen across apps, DBs, applets, domains, releases", async () => {
    const apps = await listApps(client);
    const dbs = await listDatabases(client);
    const out: Record<string, unknown> = { appStatus: distinct(apps, "status"), appScale: [...new Set(apps.map((a) => a.scale))], dbStatus: distinct(dbs, "status") };
    const app = await pickReadApp(client);
    if (app) {
      // applets answered 500 live on 2026-10-23 (404 by _id): record that instead of failing the checklist
      const [applets, releases, domains] = await Promise.all([
        listApplets(client, app).catch((e) => `error:${isLiaraError(e) ? e.status : "other"}`),
        listReleases(client, app, { count: 20 }),
        listDomains(client, app),
      ]);
      Object.assign(out, {
        ...(Array.isArray(applets) ? { appletState: distinct(applets, "state"), appletReason: distinct(applets, "reason") } : { applets }),
        releaseState: distinct(releases.releases, "state"),
        domainStatus: distinct(domains, "status"),
        domainCertificatesStatus: distinct(domains, "certificatesStatus"),
      });
      const events = await getAppEvents(client, app, { start: Math.floor(Date.now() / 1000) - 86400 }).catch((e) => `error:${isLiaraError(e) ? e.kind : "other"}`);
      out.events = Array.isArray(events) ? { count: events.length, streams: [...new Set(events.map((e) => e.stream))] } : events;
    }
    report("11 enums", out);
    expect(out.appStatus).toBeDefined();
  });

  it("12. rate-limit behaviour under a small GET burst", async () => {
    const n = Number(process.env.LIARA_RATE_PROBE ?? 15);
    const statuses: Record<string, number> = {};
    const headerNames = new Set<string>();
    // Raw fetch on purpose: the client hides response headers. The token only goes in the request header.
    for (let i = 0; i < n; i++) {
      const res = await fetch(`https://api.liara.ir/v1/me?teamID=${encodeURIComponent(TEAM_ID)}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      res.headers.forEach((_v, k) => /rate|retry|limit/i.test(k) && headerNames.add(k));
      await res.arrayBuffer();
    }
    report("12 rate limit", { requests: n, statuses, rateHeaders: [...headerNames] });
    expect(Object.keys(statuses).some((s) => s.startsWith("5"))).toBe(false);
  });
});

describe.skipIf(!process.env.LIARA_AI_BASE_URL || !process.env.LIARA_AI_API_KEY)("Liara live: 5. AI gateway", T, () => {
  const base = (process.env.LIARA_AI_BASE_URL ?? "").replace(/\/+$/, "");
  const model = process.env.LIARA_AI_MODEL ?? "openai/gpt-4.1-mini";
  const headers = { Authorization: `Bearer ${process.env.LIARA_AI_API_KEY}`, "Content-Type": "application/json" };

  it("5a. base URL form works: GET /models lists ids", async () => {
    const res = await fetch(`${base}/models`, { headers });
    const body: unknown = await res.json().catch(() => null);
    report("5a models", { status: res.status, shape: shape(body, 3) });
    expect(res.status).toBe(200);
  });

  it.skipIf(!ALLOW_BILLED)("5b. streaming chat completion (SSE) [billed, tiny]", async () => {
    const res = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model, stream: true, max_tokens: 8, messages: [{ role: "user", content: "say ok" }] }) });
    const text = await res.text();
    report("5b stream", { status: res.status, contentType: res.headers.get("content-type"), dataLines: text.split("\n").filter((l) => l.startsWith("data:")).length, done: text.includes("[DONE]") });
    expect(res.status).toBe(200);
  });

  it.skipIf(!ALLOW_BILLED)("5c. tool calling and json_schema in the chosen model [billed, tiny]", async () => {
    const tools = [{ type: "function", function: { name: "get_time", description: "time", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
    const t = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model, max_tokens: 32, tools, tool_choice: "required", messages: [{ role: "user", content: "what time is it?" }] }) });
    const tb: unknown = await t.json().catch(() => null);
    const j = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, max_tokens: 32, messages: [{ role: "user", content: "reply with ok=true" }], response_format: { type: "json_schema", json_schema: { name: "r", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } } }),
    });
    const jb: unknown = await j.json().catch(() => null);
    report("5c", { tools: { status: t.status, shape: shape(tb, 4) }, jsonSchema: { status: j.status, shape: shape(jb, 4) } });
    expect(t.status).toBeLessThan(500);
    expect(j.status).toBeLessThan(500);
  });

  it.todo("5d. 429 response shape (cannot be provoked safely; capture it from a real run and add it to docs/liara-api.md)");
});

describe.skipIf(!canMutate)("Liara live: mutating / billed (LIARA_TEST_APP only)", T, () => {
  const client: LiaraClient = liveClient();

  it("4. update-envs full-replace semantics (restarts the test app)", async () => {
    const before = await getApp(client, TEST_APP);
    const probeKey = "HAMYAR_LIVE_PROBE";
    const add = await applyEnvOps(client, TEST_APP, [{ op: "set", key: probeKey, value: "1" }]);
    report("4 add", { envCountBefore: before.envs.length, ...add });
    const remove = await applyEnvOps(client, TEST_APP, [{ op: "unset", key: probeKey }]);
    report("4 cleanup", remove);
    expect(add.verified).toBe(true);
    expect(add.keysAfter).toEqual(expect.arrayContaining(before.envs.map((e) => e.key)));
    expect(remove.verified).toBe(true);
    // If encrypted variables come back masked, a read-merge-write would corrupt them: surface that.
    report("4 encrypted vars present", { count: before.envs.filter((e) => e.encrypted).length });
  });

  it("9b. add a domain, read its record values, remove it", async (ctx) => {
    const name = process.env.LIARA_TEST_DOMAIN;
    if (!name) return ctx.skip();
    const id = await addDomain(client, TEST_APP, name);
    try {
      expect(id).toBeTruthy();
      const checked = await checkDomain(client, id!);
      report("9b check after add", { shape: shape(checked), hasCNameRecord: Boolean(checked.CNameRecord), hasVerificationCode: Boolean(checked.verificationCode) });
    } finally {
      if (id) await removeDomain(client, id);
    }
  });

  it("10. redeploy an older release by image (probe)", async (ctx) => {
    const page = await listReleases(client, TEST_APP, { count: 20 });
    const older = page.releases.filter((r) => r._id !== page.currentRelease && r.state === "READY" && r.imageName)[0];
    if (!older) return ctx.skip();
    let outcome: Record<string, unknown>;
    try {
      const id = await createRelease(client, TEST_APP, { image: older.imageName!, port: older.port ?? 3000, type: "docker", message: "hamyar live redeploy probe" });
      const events = [];
      for await (const e of watchRelease(client, id, { buildLogs: false, timeoutMs: 5 * 60_000 })) events.push(e);
      outcome = { accepted: true, final: events.at(-1) };
    } catch (e) {
      outcome = { accepted: false, kind: isLiaraError(e) ? e.kind : "other", status: isLiaraError(e) ? e.status : 0, code: isLiaraError(e) ? e.code : undefined };
    }
    report("10 redeploy by image", outcome);
    expect(outcome).toBeDefined();
  });

  it("13. create-app initial scale/isDeployed (BILLED: only if LIARA_TEST_APP does not exist yet)", async () => {
    const existing = (await listApps(client)).find((a) => a.project_id === TEST_APP);
    if (existing) {
      const detail = await getApp(client, TEST_APP);
      return report("13 existing app (not created)", { scale: detail.scale, isDeployed: detail.isDeployed, status: detail.status });
    }
    const me = await getMe(client);
    const plan = listAppPlans(me).filter((p) => p.pricePerHour > 0).sort((a, b) => a.pricePerHour - b.pricePerHour)[0];
    const bundle = plan?.bundles.find((b) => b.available);
    if (!plan || !bundle) throw new Error("no available paid app plan/bundle found");
    const app = await createApp(client, { name: TEST_APP, planID: plan.id, bundlePlanID: bundle.id, platform: "node" });
    report("13 created", { plan: plan.id, bundle: bundle.id, scale: app?.scale, isDeployed: app?.isDeployed, status: app?.status });
    expect(app).not.toBeNull();
  });
});
