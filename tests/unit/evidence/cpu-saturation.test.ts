// CPU saturation calibrated on the live run of 2026-10-23 (real Liara, rule-only mode): demo scenario cpu-bound
// (GET /report burns ~3 s of CPU synchronously), app on plan small-g2 = 0.5 vCPU / 0.5 GB, four parallel request loops
// for ~100 s. Live data: CPU (cores, 30 s step) on two applets because of a rolling restart, `0.05 0.17 0.27 0.37` and
// `0.01 0.01 0.02 0.12 0.22 0.30 0.30`; memory ~22 MB; probe `GET / -> timeout in 6003 ms`; no error lines, no access
// log, applets endpoint 500. The engine used to produce only «مشکل گذرا یا نامشخص» with a restart proposal.
import { describe, expect, it } from "vitest";
import { FindingSchema } from "@/lib/contracts/hypothesis";
import { ObservationSchema } from "@/lib/contracts/observation";
import { analyzeApp, type AppReads } from "@/lib/evidence/analyze";
import { buildRuleFindings } from "@/lib/evidence/hypotheses-rules";
import { CPU_PATH_SUMMARY, extractMetric } from "@/lib/evidence/extract/metric";
import { metricFacts } from "@/lib/evidence/facts";
import { TEMPORAL_SUMMARY } from "@/lib/evidence/temporal";
import type { EvidenceBundle } from "@/lib/evidence/types";
import { planAction } from "@/lib/agent/propose-plan";
import type { NormalizedPlan } from "@/lib/liara/account";
import type { ProbeResult } from "@/lib/canvas/types";
import { ctxOf } from "./helpers";

const D = "2026-10-23T";
const NOW = Date.parse(`${D}10:30:00.000Z`);
const s = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const PLAN = { cpu: 0.5, ramGb: 0.5 };
const MB = 1024 ** 2;
const REL = (tag: string, created: string, finished: string) => ({ _id: `r-${tag}`, tag, state: "READY", createdAt: created, finishedAt: finished, port: 3000 });
const V20 = REL("v20", `${D}09:00:00.000Z`, `${D}09:01:30.000Z`);

/** Series starting at `start` (ISO), 30 s step. */
const series = (applet: string, start: string, values: readonly number[]) => ({ applet, values: values.map((v, i) => [s(start) + i * 30, String(v)] as [number, string]) });
const PROBE_TIMEOUT: Omit<ProbeResult, "checkedAt"> = { ok: false, error: "timeout", latencyMs: 6003 };
const PROBE_FAST: Omit<ProbeResult, "checkedAt"> = { ok: true, status: 200, latencyMs: 120 };

interface Case {
  cpu: Array<ReturnType<typeof series>>;
  mem?: Array<ReturnType<typeof series>>;
  probe?: Omit<ProbeResult, "checkedAt">;
  releases?: Array<ReturnType<typeof REL>>;
  logs?: Array<{ ts: string; message: string; stream?: "stdout" | "stderr" }>;
  events?: string[];
}

function run(c: Case) {
  const releases = c.releases ?? [V20];
  const reads: AppReads = {
    name: "demo-cpu",
    now: NOW,
    sources: [],
    app: { project_id: "demo-cpu", type: "node", status: "RUNNING", scale: 1, planID: "small-g2", envs: [] } as AppReads["app"],
    releases: { currentRelease: releases[0]._id, releases } as AppReads["releases"],
    cpuSeries: { result: c.cpu } as AppReads["cpuSeries"],
    memSeries: { result: c.mem ?? [series("p2", `${D}10:26:00.000Z`, [22 * MB, 22 * MB, 22 * MB, 22 * MB])] } as AppReads["memSeries"],
    ...(c.probe ? { probe: { ...c.probe, checkedAt: `${D}10:29:50.000Z` } } : {}),
    plan: PLAN,
    logs: (c.logs ?? []).map((l) => ({ ts: l.ts, tsNs: `${Date.parse(l.ts)}000000`, stream: l.stream ?? "stdout", message: l.message, releaseId: releases[0]._id })),
    ...(c.events ? { events: c.events.map((message, i) => ({ ts: new Date(NOW - (c.events!.length - i) * 60_000).toISOString(), tsNs: `${NOW - (c.events!.length - i) * 60_000}000000`, stream: "stdout" as const, message })) } : {}),
  };
  const bundle = analyzeApp(reads);
  const findings = buildRuleFindings({ observations: bundle.observations, unknowns: bundle.unknowns });
  return { bundle, findings };
}

const metric = (b: EvidenceBundle, m: "cpu" | "memory") => b.observations.find((o) => o.kind === "metric" && o.params.metric === m)!;
const PLANS: NormalizedPlan[] = [
  { id: "small-g2", available: true, ramGb: 0.5, cpu: 0.5, pricePerHour: 60, pricePerMonth: 43_200, priceKnown: true } as NormalizedPlan,
  { id: "medium-g2", available: true, ramGb: 1, cpu: 1, pricePerHour: 120, pricePerMonth: 86_400, priceKnown: true } as NormalizedPlan,
];
function proposalOf(r: ReturnType<typeof run>, requested?: "restart") {
  const c = r.findings.candidates[0];
  const h = r.findings.hypotheses.find((x) => x.id === c?.id);
  return planAction({
    target: { kind: "app", name: "demo-cpu" },
    ...(h && c ? { top: { hypothesis: h, cause: c.cause, candidate: c } } : {}),
    observations: r.bundle.observations,
    app: { planId: "small-g2", envKeys: [] },
    plans: { all: PLANS },
    ...(requested ? { requested } : {}),
  });
}
function valid(r: ReturnType<typeof run>) {
  for (const o of r.bundle.observations) expect(ObservationSchema.safeParse(o).success, o.id).toBe(true);
  expect(FindingSchema.safeParse({ facts: r.bundle.observations, hypotheses: r.findings.hypotheses, ruledOut: r.findings.ruledOut, unknowns: r.findings.unknowns, limitsNote: r.bundle.limits }).success).toBe(true);
}

// Live (a): the outgoing applet ramps and disappears, the new one plateaus at 0.30 cores = 60% of 0.5 vCPU.
const LIVE_CPU = [series("p1", `${D}10:25:00.000Z`, [0.05, 0.17, 0.27, 0.37]), series("p2", `${D}10:26:00.000Z`, [0.01, 0.01, 0.02, 0.12, 0.22, 0.3, 0.3])];

describe("CPU pressure relative to the plan (live calibration, 0.5 vCPU)", () => {
  it("(a) live series + probe timeout -> cpu_saturation medium, no restart/RAM proposal, memory not blamed", () => {
    const r = run({ cpu: LIVE_CPU, probe: PROBE_TIMEOUT });
    valid(r);
    const cpu = metric(r.bundle, "cpu");
    expect(cpu.summary).toBe("evidence.metric.cpu_high");
    expect(cpu.params).toMatchObject({ planCpu: 0.5, cpuCores: 0.3, cpuPct: 60, samples: 7, sustainedSamples: 2, corroboration: "probe_timeout", applets: 2, sig: 1 });
    expect(Number(cpu.params.highSharePct)).toBeCloseTo(28.6, 1);
    expect(cpu.text).toContain("0.3 cores / plan 0.5 cores (60% of plan)");

    const [top, ...rest] = r.findings.candidates;
    expect(top.cause).toBe("cpu_saturation");
    expect(top.evidence.level).toBe("medium");
    expect(top.actionHint).toBeUndefined();
    expect(rest.map((c) => c.cause)).not.toContain("transient_unknown");
    expect(r.findings.candidates.map((c) => c.cause)).not.toContain("oom");
    expect(top.titleFa).toContain("اشباع پردازنده");
    expect(top.explanationFa).toContain("۶۰٪");
    expect(top.explanationFa).toContain("حل نمی‌کند");
    expect(top.explanationFa).toContain("پیشنهاد (بر پایهٔ این فرضیه)");
    expect(top.explanationFa).toContain("timeout");
    // Memory: 22 MB of 0.5 GB, never cited; RAM is ruled out explicitly.
    const mem = metric(r.bundle, "memory");
    expect(mem.summary).toBe("evidence.metric.memory_normal");
    expect(top.supports).not.toContain(mem.id);
    expect(r.findings.ruledOut.map((x) => x.titleFa)).toContain("کمبود حافظه رد شد");

    expect(proposalOf(r)).toEqual({ kind: "none", reason: "no_candidate" });
    // Even an explicit «restart» request is refused: a restart does not help a CPU-bound handler.
    expect(proposalOf(r, "restart")).toEqual({ kind: "none", reason: "restart_wont_help" });
  });

  it("(b) 0.30 cores sustained (60%) with fast healthy probes -> info observation only, no hypothesis", () => {
    const r = run({ cpu: [series("p1", `${D}10:26:00.000Z`, [0.3, 0.3, 0.3, 0.3, 0.3, 0.3])], probe: PROBE_FAST });
    valid(r);
    const cpu = metric(r.bundle, "cpu");
    expect(cpu).toMatchObject({ summary: "evidence.metric.cpu_elevated", severity: "info", params: { pressure: 1, corroborated: 0, sig: 0 } });
    expect(r.findings.candidates).toEqual([]);
    // Not "ruled out" either: elevated CPU is not normal CPU.
    expect(r.findings.ruledOut.map((x) => x.titleFa)).not.toContain("اشباع پردازنده رد شد");
  });

  it("(c) memory leak to > 85% + OOM kill -> OOM hypothesis and a costed resize, as before", () => {
    const grow = [0.6, 0.66, 0.72, 0.78, 0.84, 0.9, 0.95].map((x) => x * 512 * MB);
    const r = run({
      cpu: [series("p1", `${D}10:26:00.000Z`, [0.05, 0.05, 0.06, 0.05, 0.05, 0.06, 0.05])],
      mem: [series("p1", `${D}10:26:00.000Z`, grow)],
      probe: PROBE_FAST,
      events: ["Killing: container demo-cpu OOMKilled"],
    });
    valid(r);
    expect(metric(r.bundle, "memory").params).toMatchObject({ nearLimit: 1, growing: 1, sig: 1 });
    const top = r.findings.candidates[0];
    expect(top.cause).toBe("oom");
    expect(top.actionHint).toBe("resize");
    expect(r.findings.candidates.map((c) => c.cause)).not.toContain("cpu_saturation");
    const p = proposalOf(r);
    expect(p.kind).toBe("action");
    if (p.kind !== "action" || p.plan.params.type !== "resize") throw new Error("expected resize");
    expect(p.plan.params.planId).toBe("medium-g2");
    expect(p.plan.costEstimate).toEqual({ perHourToman: 120, perMonthToman: 120 * 720 });
  });

  it("(d) a single CPU spike without a latency symptom -> no hypothesis", () => {
    const r = run({ cpu: [series("p1", `${D}10:26:00.000Z`, [0.05, 0.05, 0.48, 0.05, 0.05, 0.05])], probe: PROBE_FAST });
    valid(r);
    expect(metric(r.bundle, "cpu").params).toMatchObject({ pressure: 1, corroborated: 0, sig: 0, sustainedSamples: 1 });
    expect(r.findings.candidates).toEqual([]);
  });

  it("(e) unknown cause (probe timeout, CPU and memory calm) -> weak fallback without any proposal", () => {
    const r = run({ cpu: [series("p1", `${D}10:26:00.000Z`, [0.02, 0.03, 0.02, 0.03])], probe: PROBE_TIMEOUT });
    valid(r);
    const [top] = r.findings.candidates;
    expect(top.cause).toBe("transient_unknown");
    expect(top.evidence.level).toBe("weak");
    expect(top.actionHint).toBeUndefined();
    expect(top.explanationFa).toContain("access log");
    expect(proposalOf(r)).toEqual({ kind: "none", reason: "weak_evidence" });
  });

  it("(f) rolling restart: the outgoing applet's high tail is not spliced into a false 'sustained'", () => {
    // Old applet ends high (0.42, 0.45 = 84-90%), the new one is calm: judged on the serving (newest) applet.
    const cpu = [series("p1", `${D}10:24:00.000Z`, [0.3, 0.35, 0.42, 0.45]), series("p2", `${D}10:26:00.000Z`, [0.04, 0.05, 0.05, 0.04, 0.05])];
    const facts = metricFacts(undefined, { result: cpu } as Parameters<typeof metricFacts>[1]);
    expect(facts?.cpuSeries?.map((p) => p.v)).toEqual([0.04, 0.05, 0.05, 0.04, 0.05]);
    const r = run({ cpu, probe: PROBE_TIMEOUT });
    valid(r);
    expect(metric(r.bundle, "cpu")).toMatchObject({ summary: "evidence.metric.cpu_normal", params: { pressure: 0, sig: 0, applets: 2 } });
    expect(r.findings.candidates.map((c) => c.cause)).not.toContain("cpu_saturation");
    // Judged on the outgoing applet (the old busiest-applet choice), the same probe timeout would make a signature.
    const old = extractMetric(ctxOf({ plan: PLAN, probe: { ...PROBE_TIMEOUT, checkedAt: `${D}10:29:50.000Z` }, metrics: { cpuSeries: cpu[0].values.map(([t, v]) => ({ t, v: Number(v) })) } }))[0];
    expect(old.params.sig).toBe(1);
  });
});

describe("cpu_saturation levels and ranking", () => {
  it("strong: slow requests of one path start with the CPU pressure (access log)", () => {
    const cpu = [series("p1", `${D}10:25:00.000Z`, [0.02, 0.03, 0.02, 0.03, 0.31, 0.33, 0.34, 0.33])];
    const onset = Date.parse(`${D}10:27:00.000Z`);
    const logs = [
      ...[0, 20, 40].map((x) => ({ ts: new Date(onset - 120_000 + x * 1000).toISOString(), message: "GET /report 200 40.1 ms - 512" })),
      ...[5, 35, 65, 95].map((x) => ({ ts: new Date(onset + x * 1000).toISOString(), message: "GET /report 200 4800.3 ms - 512" })),
    ];
    const r = run({ cpu, probe: PROBE_TIMEOUT, logs });
    valid(r);
    const path = r.bundle.observations.find((o) => o.summary === CPU_PATH_SUMMARY)!;
    expect(path.params).toMatchObject({ path: "/report", slowCount: 4, correlated: 1, sig: 0 });
    const top = r.findings.candidates[0];
    expect(top).toMatchObject({ cause: "cpu_saturation" });
    expect(top.evidence.level).toBe("strong");
    expect(top.supports).toContain(path.id);
    expect(top.explanationFa).toContain("/report");
    expect(top.actionHint).toBeUndefined();
    expect(r.findings.hypotheses[0].level).toBe("strong");
  });

  it("strong: CPU was calm on the old container and saturates within 5 min of a release; medium when it was already high", () => {
    const v21 = REL("v21", `${D}10:25:00.000Z`, `${D}10:26:00.000Z`);
    const calmBefore = [series("p1", `${D}10:22:00.000Z`, [0.03, 0.04, 0.03, 0.04, 0.03, 0.04]), series("p2", `${D}10:26:30.000Z`, [0.05, 0.31, 0.33, 0.34, 0.33])];
    const a = run({ cpu: calmBefore, probe: PROBE_TIMEOUT, releases: [v21, V20] });
    valid(a);
    expect(a.findings.candidates[0]).toMatchObject({ cause: "cpu_saturation", releaseTag: "v21" });
    expect(a.findings.candidates[0].evidence.level).toBe("strong");
    expect(a.findings.candidates[0].explanationFa).toContain("v21");

    const highBefore = [series("p1", `${D}10:22:00.000Z`, [0.03, 0.04, 0.31, 0.33, 0.34, 0.33]), series("p2", `${D}10:26:30.000Z`, [0.05, 0.31, 0.33, 0.34, 0.33])];
    const b = run({ cpu: highBefore, probe: PROBE_TIMEOUT, releases: [v21, V20] });
    valid(b);
    expect(b.bundle.observations.some((o) => o.summary === TEMPORAL_SUMMARY)).toBe(true);
    expect(b.findings.candidates[0].cause).toBe("cpu_saturation");
    expect(b.findings.candidates[0].evidence.level).toBe("medium");
  });

  it("the live rolling restart itself (new container right after a release) is not a release correlation", () => {
    const v21 = REL("v21", `${D}10:25:00.000Z`, `${D}10:25:50.000Z`);
    const r = run({ cpu: LIVE_CPU, probe: PROBE_TIMEOUT, releases: [v21, V20] });
    expect(r.findings.candidates[0].cause).toBe("cpu_saturation");
    expect(r.findings.candidates[0].evidence.level).toBe("medium");
  });

  it("competing runtime errors or OOM lower it to weak (listed as contradictions)", () => {
    const r = run({ cpu: LIVE_CPU, probe: PROBE_TIMEOUT, events: ["Killing: container demo-cpu OOMKilled"] });
    const cpu = r.findings.candidates.find((c) => c.cause === "cpu_saturation")!;
    expect(cpu.evidence.level).toBe("weak");
    expect(cpu.contradicts.length).toBeGreaterThan(0);
  });

  it("sustained >= 80% and corroborated: a tier-2 resize to a bigger CPU plan, costed; never restart", () => {
    const r = run({ cpu: [series("p1", `${D}10:26:00.000Z`, [0.45, 0.46, 0.47, 0.45, 0.46])], probe: { ok: true, status: 200, latencyMs: 4200 } });
    valid(r);
    const top = r.findings.candidates[0];
    expect(top).toMatchObject({ cause: "cpu_saturation", actionHint: "resize" });
    expect(top.evidence.level).toBe("medium");
    const p = proposalOf(r);
    if (p.kind !== "action" || p.plan.params.type !== "resize") throw new Error("expected resize");
    expect(p.plan.params.planId).toBe("medium-g2");
    expect(p.plan.costEstimate?.perHourToman).toBe(120);
  });

  it("sustained >= 80% without a latency symptom is a signature (medium) but gets no proposal", () => {
    const r = run({ cpu: [series("p1", `${D}10:26:00.000Z`, [0.45, 0.46, 0.47, 0.45, 0.46])], probe: PROBE_FAST });
    const top = r.findings.candidates[0];
    expect(top.cause).toBe("cpu_saturation");
    expect(top.evidence.level).toBe("medium");
    expect(top.actionHint).toBeUndefined();
    expect(proposalOf(r)).toEqual({ kind: "none", reason: "no_candidate" });
  });
});
