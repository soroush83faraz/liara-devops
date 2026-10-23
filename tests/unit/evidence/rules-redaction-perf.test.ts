import { beforeAll, describe, expect, it } from "vitest";
import { analyzeApp } from "@/lib/evidence/analyze";
import { runExtractors } from "@/lib/evidence/extract";
import { buildRuleFindings } from "@/lib/evidence/hypotheses-rules";
import { groupLines, toEvidenceLine } from "@/lib/evidence/lines";
import { assignIds, draft } from "@/lib/evidence/observe";
import { buildRedactor, redactBundle } from "@/lib/evidence/redact-bundle";
import { detectOnset } from "@/lib/evidence/temporal";
import type { EvidenceBundle, Observation } from "@/lib/evidence/types";
import { ctxOf, iso, T0 } from "./helpers";

const obs = (drafts: ReturnType<typeof draft>[]): Observation[] => assignIds(drafts);

describe("rule candidates: restart policy", () => {
  it("a single OOM kill without memory growth hints restart (transient)", () => {
    const f = buildRuleFindings({ observations: obs([draft("oom", "liara:events", "evidence.oom.container", "error", "OOMKilled", { scope: "container", kills: 1, sig: 1 })]) });
    expect(f.candidates[0]).toMatchObject({ cause: "oom", actionHint: "restart" });
  });
  it("repeated OOM kills hint resize", () => {
    const f = buildRuleFindings({ observations: obs([draft("oom", "liara:events", "evidence.oom.container", "error", "OOMKilled", { scope: "container", kills: 3, sig: 1 })]) });
    expect(f.candidates[0].actionHint).toBe("resize");
  });
  // Changed 2026-10-23: the fallback used to hint `restart`. On a live cpu-bound run (0.5 vCPU) that was the only
  // output, and a restart would not have helped. A weak, unexplained symptom now carries no action; the text asks
  // for more evidence instead (see propose-plan `weak_evidence`).
  it("an unhealthy applet without any error signature is transient: weak, no action hint, asks for more evidence", () => {
    const f = buildRuleFindings({ observations: obs([draft("applet_state", "liara:applets", "evidence.applet.unhealthy", "warn", "p: Running (Readiness probe failed)", { sig: 0 })]) });
    expect(f.candidates[0]).toMatchObject({ cause: "transient_unknown" });
    expect(f.candidates[0].actionHint).toBeUndefined();
    expect(f.hypotheses[0].level).toBe("weak");
    expect(f.hypotheses[0].explanationFa).toContain("access log");
  });
  it("crash without a release correlation has no action hint (never restart)", () => {
    const f = buildRuleFindings({ observations: obs([draft("crash", "liara:logs", "evidence.crash.exception", "error", "TypeError: x", { errorType: "TypeError", sig: 1 })]) });
    expect(f.candidates[0]).toMatchObject({ cause: "crash_after_release" });
    expect(f.candidates[0].actionHint).toBeUndefined();
  });
  it("missing env never hints restart even with crash loops", () => {
    const f = buildRuleFindings({
      observations: obs([
        draft("missing_env", "liara:logs", "evidence.missing_env", "error", "x", { key: "A_B", sig: 1 }),
        draft("crash", "liara:events", "evidence.crash.crashloop", "error", "loop", { restarts: 5, sig: 1 }),
      ]),
    });
    expect(f.candidates.map((c) => c.actionHint)).toEqual(["set_env"]);
  });
  it("produces Persian titles from templates and ruled-out entries", () => {
    const f = buildRuleFindings({
      observations: obs([
        draft("missing_env", "liara:logs", "evidence.missing_env", "error", "x", { key: "SESSION_SECRET", count: 3, sig: 1 }),
        draft("metric", "liara:metrics", "evidence.metric.memory_normal", "info", "m", { metric: "memory", memPct: 61, sig: 0 }),
      ]),
    });
    expect(f.hypotheses[0].titleFa).toBe("متغیر محیطی SESSION_SECRET تعریف نشده است");
    expect(f.hypotheses[0].explanationFa).toContain("۳");
    expect(f.ruledOut[0]).toMatchObject({ titleFa: "کمبود حافظه رد شد", observationIds: ["O2"] });
    expect(f.ruledOut[0].reasonFa).toContain("۶۱");
  });
  it("no observations -> no candidates; unknowns pass through", () => {
    const f = buildRuleFindings({ observations: [], unknowns: [{ code: "x", descriptionFa: "نامشخص", howToGet: "راه" }] });
    expect(f).toMatchObject({ candidates: [], hypotheses: [], unknowns: [{ descriptionFa: "نامشخص", howToGet: "راه" }] });
  });
});

describe("redaction gate", () => {
  const PLANTED = {
    token: "liara-token-SYNTHETIC-0123456789",
    envValue: "env-value-SYNTHETIC-zyxwvu",
    dbPassword: "db-pass-SYNTHETIC-98765",
  };
  it("planted token, env value and DB password never survive analysis", () => {
    const logLines = [
      `request with Authorization: Bearer ${PLANTED.token}`,
      `config loaded value=${PLANTED.envValue}`,
      `Error: SESSION_SECRET is not defined (had ${PLANTED.envValue})`,
      `connecting to postgres://admin:${PLANTED.dbPassword}@shop-db:5432/app`,
      `password=${PLANTED.dbPassword}`,
      `retrying with ${PLANTED.dbPassword}`,
    ].map((message, i) => ({ ts: iso(20, i), tsNs: "0", stream: "stderr" as const, message }));
    const bundle = analyzeApp({
      name: "demo-shop",
      now: T0,
      sources: [{ source: "runtime_logs", status: "ok" }],
      app: { project_id: "demo-shop", envs: [{ key: "WEIRD_SETTING", value: PLANTED.envValue }] },
      logs: logLines,
      knownSecrets: [PLANTED.token, PLANTED.dbPassword],
    });
    const out = JSON.stringify(bundle);
    for (const v of Object.values(PLANTED)) expect(out).not.toContain(v);
    expect(out).toContain("«redacted»");
    // Diagnostic content survives redaction.
    expect(bundle.observations.some((o) => o.kind === "missing_env" && o.params.key === "SESSION_SECRET")).toBe(true);
  });
  it("redactBundle scrubs raw, params and timeline too", () => {
    const r = buildRedactor({ knownSecrets: [PLANTED.dbPassword] });
    const bundle: EvidenceBundle = {
      target: { kind: "app", name: "x" },
      collectedAt: iso(30),
      windowMin: 15,
      sources: [],
      raw: { nested: { note: `pw ${PLANTED.dbPassword}` }, password: "plain" },
      observations: obs([draft("event", "liara:events", "evidence.x", "info", PLANTED.dbPassword, { detail: PLANTED.dbPassword })]),
      timeline: [{ ts: iso(1), kind: "restart", label: "timeline.restart", params: { tag: PLANTED.dbPassword } }],
      unknowns: [],
      limits: [],
    };
    const out = JSON.stringify(redactBundle(bundle, r));
    expect(out).not.toContain(PLANTED.dbPassword);
    expect(out).not.toContain("plain");
  });
});

describe("performance guard", () => {
  // Guards against accidental quadratic behaviour in the log pipeline, not against the speed of one machine. Wall-clock
  // numbers swing with load (a 200 ms budget measured 204 ms once when 147 test files ran in parallel), so: the absolute
  // budget is generous (1000 ms), each measurement is the best of 3 runs after a warm-up, and the scaling check is a
  // RATIO (10x the input must take at most ~25x the time: linear work is ~10x, quadratic work ~100x).
  const msgs = [
    "GET /api/items/{i} 200 12 ms",
    "Error: connect ECONNREFUSED 10.0.0.5:5432",
    "TypeError: Cannot read properties of undefined (reading 'x')",
    "    at handler (/app/src/h.js:{i}:5)",
    "Error: SESSION_SECRET is not defined",
    "info: processed job {i} in {i} ms",
    "GET /login 500 {i} ms",
  ];
  const rawOf = (n: number) => [...Array(n)].map((_, i) => ({ ts: new Date(T0 - 900_000 + i * 180).toISOString(), message: msgs[i % msgs.length].replace(/\{i\}/g, String(i)) }));
  const r = buildRedactor({ knownSecrets: ["synthetic-known-secret-1"] });
  const run = (raw: Array<{ ts: string; message: string }>) => {
    const t0 = performance.now();
    const lines = raw.map((l) => toEvidenceLine(l, (s) => r.string(s)));
    const ctx = { ...ctxOf(), logs: lines, logGroups: groupLines(lines) };
    const drafts = runExtractors(ctx);
    detectOnset(lines, T0, 15);
    return { elapsed: performance.now() - t0, drafts };
  };
  const bestOf3 = (raw: Array<{ ts: string; message: string }>) => Math.min(run(raw).elapsed, run(raw).elapsed, run(raw).elapsed);

  beforeAll(() => {
    // JIT warm-up so the first measured run does not pay for compilation.
    run(rawOf(5000));
    run(rawOf(500));
  });

  it("5k log lines: normalise + group + extract + onset < 1000 ms (best of 3)", () => {
    const raw = rawOf(5000);
    const first = run(raw);
    const best = Math.min(first.elapsed, bestOf3(raw));
    expect(first.drafts.length).toBeGreaterThan(0);
    expect(best).toBeLessThan(1000);
  });

  it("scaling: 10x the input takes at most ~25x the time (best of 3 each)", () => {
    // 1 ms floor on the small run: sub-millisecond timings are noise, not signal.
    const small = Math.max(bestOf3(rawOf(500)), 1);
    const big = bestOf3(rawOf(5000));
    expect(big / small).toBeLessThan(25);
  });
});
