import { describe, expect, it } from "vitest";
import { FindingSchema } from "@/lib/contracts/hypothesis";
import { ObservationSchema } from "@/lib/contracts/observation";
import { collectAppEvidence, collectDbEvidence } from "@/lib/evidence/collect";
import { buildRuleFindings } from "@/lib/evidence/hypotheses-rules";
import type { EvidenceBundle } from "@/lib/evidence/types";
import { fakeLiara, fakeProbe, loadScenario, nowOf, SCENARIOS, TEST_TOKEN } from "./helpers";

async function run(name: string, overrides: Record<string, number> = {}) {
  const s = loadScenario(name);
  const backend = fakeLiara(s, overrides);
  const bundle = await collectAppEvidence({ liara: backend.client, name: s.name, probe: fakeProbe(s), now: nowOf(s), knownSecrets: [TEST_TOKEN] });
  return { s, bundle, calls: backend.calls, findings: buildRuleFindings({ observations: bundle.observations, unknowns: bundle.unknowns }) };
}

/** Shape-only summary for snapshots: kinds, summaries and levels, never text. */
function summarize(bundle: EvidenceBundle, findings: ReturnType<typeof buildRuleFindings>) {
  return {
    sources: bundle.sources.filter((x) => x.status !== "ok").map((x) => `${x.source}:${x.status}:${x.error ?? ""}`),
    observations: bundle.observations.map((o) => `${o.id} ${o.kind} ${o.summary}${o.flagged ? " flagged" : ""}`),
    hypotheses: findings.candidates.map((c) => `${c.id ?? "-"} ${c.cause} ${c.evidence.level} ${c.actionHint ?? "-"} +${c.supports.join(",")} -${c.contradicts.join(",")}`),
    ruledOut: findings.ruledOut.map((r) => r.observationIds.join(",")),
    unknowns: bundle.unknowns.map((u) => u.code),
    correlation: bundle.correlation ? `${bundle.correlation.changeKind} ${bundle.correlation.withReleaseTag ?? ""} ${bundle.correlation.within5min}` : null,
  };
}

const EXPECT: Record<string, { cause?: string; level?: string; hint?: string | null; none?: boolean }> = {
  healthy: { none: true },
  "missing-env": { cause: "missing_env", level: "strong", hint: "set_env" },
  "wrong-port": { cause: "wrong_port", level: "strong", hint: "update_port" },
  "crash-loop": { cause: "crash_after_release", level: "strong", hint: "redeploy_previous" },
  oom: { cause: "oom", level: "medium", hint: "resize" },
  "cpu-bound-slow": { cause: "cpu_saturation", level: "medium", hint: "resize" },
  "build-failure": { cause: "build_failure", level: "strong", hint: null },
  "db-unreachable": { cause: "db_unreachable", level: "medium", hint: null },
  "db-stopped": { cause: "db_unreachable", level: "medium", hint: "scale" },
  "injection-in-logs": { none: true },
  "logs-unavailable": { cause: "wrong_port", level: "weak", hint: null },
  "partial-failure": { cause: "missing_env", level: "medium", hint: "set_env" },
};

describe.each(SCENARIOS)("scenario %s", (name) => {
  it("produces the expected top finding and a stable shape", async () => {
    const { bundle, findings } = await run(name);
    const exp = EXPECT[name];
    if (exp.none) expect(findings.candidates).toEqual([]);
    else {
      const top = findings.candidates[0];
      expect(top.cause).toBe(exp.cause);
      expect(top.evidence.level).toBe(exp.level);
      expect(top.actionHint ?? null).toBe(exp.hint);
    }
    expect(summarize(bundle, findings)).toMatchSnapshot();
  });

  it("emits contract-valid observations and a schema-valid Finding", async () => {
    const { bundle, findings } = await run(name);
    for (const o of bundle.observations) expect(ObservationSchema.safeParse(o).success, o.id).toBe(true);
    const finding = { facts: bundle.observations, hypotheses: findings.hypotheses, ruledOut: findings.ruledOut, unknowns: findings.unknowns, limitsNote: bundle.limits };
    const parsed = FindingSchema.safeParse(finding);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
  });

  it("is deterministic", async () => {
    const a = await run(name);
    const b = await run(name);
    expect(JSON.stringify(a.bundle)).toBe(JSON.stringify(b.bundle));
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
  });

  it("never leaks planted secrets or env values", async () => {
    const { s, bundle, findings } = await run(name);
    const out = JSON.stringify({ bundle, findings });
    const app = s.app as { project?: { envs?: Array<{ value: string }> } } | undefined;
    for (const env of app?.project?.envs ?? []) if (env.value.length >= 6 && env.value !== "production") expect(out).not.toContain(env.value);
    for (const secret of ["SYNTH-DB-PASS-1234", "SYNTH-ROOT-PW-9876", "synthtoken-ABCDEFGHIJKLMNOP1234", "synthetic-key-abcdef", TEST_TOKEN]) {
      expect(out).not.toContain(secret);
    }
    expect(out).not.toContain("root_password");
  });

  it("deterministic app errors never get a restart hint", async () => {
    const { bundle, findings } = await run(name);
    const deterministic = bundle.observations.some((o) => !o.flagged && o.params.sig === 1 && ["missing_env", "crash", "port_mismatch", "build_error", "connection_error"].includes(o.kind));
    if (deterministic) expect(findings.candidates.some((c) => c.actionHint === "restart")).toBe(false);
  });
});

describe("collection behaviour", () => {
  it("reads build logs only for a FAILED/BUILDING/TIMEDOUT newest release", async () => {
    expect((await run("build-failure")).calls.some((c) => c.includes("/build-logs"))).toBe(true);
    expect((await run("healthy")).calls.some((c) => c.includes("/build-logs"))).toBe(false);
  });

  it("keeps env KEY names only in raw data", async () => {
    const { bundle } = await run("missing-env");
    expect((bundle.raw.app as { envKeys: string[] }).envKeys).toEqual(["API_KEY", "DATABASE_URL", "NODE_ENV"]);
    expect(JSON.stringify(bundle.raw)).not.toContain("\"envs\"");
  });

  it("turns every failed source into an explicit unknown", async () => {
    const { bundle } = await run("partial-failure");
    const failed = bundle.sources.filter((x) => x.status === "failed").map((x) => x.source);
    expect(failed.sort()).toEqual(["events", "metrics_summary", "plan", "release_detail"]);
    for (const src of failed) expect(bundle.unknowns.some((u) => u.source === src && u.descriptionFa && u.howToGet)).toBe(true);
    expect(bundle.limits.length).toBeGreaterThan(1);
  });

  it("survives every source failing at once", async () => {
    const all = { app: 500, applets: 500, releases: 500, events: 500, logs: 500, metricsSummary: 500, metricsCpu: 500, metricsMemory: 500, me: 500, databases: 500 };
    const s = loadScenario("healthy");
    const bundle = await collectAppEvidence({ liara: fakeLiara(s, all).client, name: s.name, probe: async () => { throw new Error("probe down"); }, now: nowOf(s) });
    expect(bundle.sources.filter((x) => x.status === "failed").length).toBeGreaterThanOrEqual(10);
    expect(bundle.unknowns.length).toBeGreaterThanOrEqual(10);
    expect(buildRuleFindings({ observations: bundle.observations }).candidates).toEqual([]);
  });

  it("applets 500 alone (live 2026-10-23) -> only that source fails, an explicit unknown, every other source still collected", async () => {
    const s = loadScenario("healthy");
    const bundle = await collectAppEvidence({ liara: fakeLiara(s, { applets: 500 }).client, name: s.name, probe: async () => { throw new Error("probe down"); }, now: nowOf(s) });
    expect(bundle.sources.find((x) => x.source === "applets")?.status).toBe("failed");
    expect(bundle.sources.find((x) => x.source === "releases")?.status).toBe("ok");
    expect(bundle.unknowns.some((u) => u.source === "applets" && u.descriptionFa)).toBe(true);
    expect(bundle.observations.some((o) => o.source === "liara:applets")).toBe(false);
  });

  it("logs unavailable -> unknown entry, never a strong finding", async () => {
    const { bundle, findings } = await run("logs-unavailable");
    expect(bundle.unknowns.map((u) => u.code)).toContain("source_failed.runtime_logs");
    expect(findings.candidates.every((c) => c.evidence.level !== "strong")).toBe(true);
  });

  it("injection lines are flagged, kept, and never become hypotheses or actions", async () => {
    const { bundle, findings } = await run("injection-in-logs");
    const flagged = bundle.observations.filter((o) => o.flagged);
    expect(flagged.length).toBeGreaterThanOrEqual(3);
    const flaggedIds = new Set(flagged.map((o) => o.id));
    for (const h of findings.hypotheses) expect(h.supports.some((id) => flaggedIds.has(id))).toBe(false);
    expect(findings.candidates.some((c) => c.actionHint)).toBe(false);
  });

  it("CPU saturation never cites memory", async () => {
    const { bundle, findings } = await run("cpu-bound-slow");
    const memIds = bundle.observations.filter((o) => o.kind === "metric" && o.params.metric === "memory").map((o) => o.id);
    const cpu = findings.candidates.find((c) => c.cause === "cpu_saturation")!;
    expect(cpu.supports.some((id) => memIds.includes(id))).toBe(false);
    expect(findings.ruledOut.map((r) => r.titleFa)).toContain("کمبود حافظه رد شد");
    expect(findings.candidates.some((c) => c.cause === "oom")).toBe(false);
  });
});

describe("collectDbEvidence", () => {
  async function runDb(overrides: Record<string, number> = {}) {
    const s = loadScenario("db-stopped");
    const backend = fakeLiara(s, overrides);
    const bundle = await collectDbEvidence({ liara: backend.client, hostnameOrId: "shop-db", now: nowOf(s), apps: s.dbApps });
    return { bundle, findings: buildRuleFindings({ observations: bundle.observations, unknowns: bundle.unknowns }) };
  }

  it("reports a stopped DB, its referencing apps, and hints scale", async () => {
    const { bundle, findings } = await runDb();
    expect(bundle.target).toEqual({ kind: "db", name: "shop-db" });
    expect(bundle.observations.map((o) => o.summary)).toEqual(expect.arrayContaining(["evidence.db.stopped", "evidence.db.referenced_by"]));
    expect(findings.candidates[0]).toMatchObject({ cause: "db_unreachable", actionHint: "scale" });
    expect(JSON.stringify(bundle)).not.toContain("SYNTH-ROOT-PW-9876");
    expect(summarize(bundle, findings)).toMatchSnapshot();
  });

  it("failed DB reads become unknowns", async () => {
    const { bundle } = await runDb({ databaseDetail: 500, dbEvents: 500 });
    expect(bundle.unknowns.map((u) => u.code)).toEqual(expect.arrayContaining(["source_failed.db_detail", "source_failed.db_events"]));
  });
});
