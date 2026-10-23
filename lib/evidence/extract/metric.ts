// metric: CPU relative to plan CPU, memory relative to plan RAM, CPU pressure and memory growth.
// Units are unverified [VAL]: CPU samples are taken as cores in use, memory samples as bytes.
//
// CPU thresholds are heuristics calibrated on a live run (2026-10-23, plan small-g2 = 0.5 vCPU): a single-threaded Node
// handler burning CPU on every request plateaued at 0.30 cores (60% of the plan) in 30-s averages while the health
// probe timed out. Such an app never shows 100% in a 30-s average, so "pressure" starts at 60% of the plan and needs a
// latency symptom (or >= 80% sustained) before it becomes a signature of `cpu_saturation`.
import { draft, SIG, toIso } from "../observe";
import type { DraftObservation, ExtractContext, MetricFacts, PlanLimits } from "../types";
import { accessLatencyMs, accessStats, parseAccessLine } from "./http-status";
import { SLOW_PROBE_MS } from "./probe";

/** A sample at or above this share of the plan CPU counts as "high" (pressure). */
export const CPU_PRESSURE_PCT = 60;
/** A single sample at or above this is pressure on its own. */
export const CPU_SPIKE_PCT = 85;
/** "Sustained high": >= SUSTAINED_SHARE of the samples at or above this; a signature even without a latency symptom. */
export const CPU_HIGH_PCT = 80;
/** Consecutive high samples that make pressure. */
export const PRESSURE_RUN = 2;
/** Or this share of high samples (with at least MIN_SHARE_SAMPLES samples). */
export const PRESSURE_SHARE = 0.4;
export const MIN_SHARE_SAMPLES = 3;
/** Share of series samples at/above CPU_HIGH_PCT that counts as "sustained". */
export const SUSTAINED_SHARE = 0.7;
export const MEM_NEAR_LIMIT_PCT = 85;
export const MEM_HIGH_PCT = 70;
/** Access-log correlation: slow requests (>= SLOW_PROBE_MS) of one path, starting close to the CPU onset. */
export const CPU_PATH_SUMMARY = "evidence.http.slow_path_onset";
export const SLOW_PATH_MIN = 3;
export const SLOW_PATH_SHARE = 0.6;
export const PATH_ONSET_BEFORE_SEC = 60;
export const PATH_ONSET_AFTER_SEC = 120;
const GIB = 1024 ** 3;

export function cpuPct(cores: number | undefined, plan: PlanLimits | undefined): number | undefined {
  return cores !== undefined && plan?.cpu ? (cores / plan.cpu) * 100 : undefined;
}
export function memPct(bytes: number | undefined, plan: PlanLimits | undefined): number | undefined {
  return bytes !== undefined && plan?.ramGb ? (bytes / (plan.ramGb * GIB)) * 100 : undefined;
}

/** Least-squares slope of y over x (per x unit); undefined with < 3 points. */
export function slope(points: ReadonlyArray<{ t: number; v: number }>): number | undefined {
  if (points.length < 3) return undefined;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.t, 0) / n;
  const my = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - mx) * (p.v - my);
    den += (p.t - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Normalises sample times to seconds (some series report ms). */
const sec = (t: number) => (t > 1e11 ? t / 1000 : t);
/** Percent rounded to 0.1 so 0.30 / 0.5 cores is exactly 60, not 59.999... */
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface CpuStats {
  /** Current value (summary / newest sample) as % of plan. */
  pct?: number;
  peakPct?: number;
  samples: number;
  /** Share of samples >= CPU_PRESSURE_PCT. */
  highShare?: number;
  /** Longest run of consecutive samples >= CPU_PRESSURE_PCT. */
  maxRun: number;
  /** >= SUSTAINED_SHARE of >= 3 samples at/above CPU_HIGH_PCT; undefined with < 3 samples. */
  sustained?: boolean;
  pressure: boolean;
  /** Series time (s) where the pressure starts, when the series has one. */
  onsetSec?: number;
}

/** Pressure statistics of the serving applet's series (or the single current value when there is no series). */
export function cpuStats(m: MetricFacts | undefined, plan: PlanLimits | undefined): CpuStats {
  const pct = cpuPct(m?.cpuCores, plan);
  const pts = (m?.cpuSeries ?? [])
    .map((p) => ({ t: sec(p.t), v: cpuPct(p.v, plan) }))
    .filter((p): p is { t: number; v: number } => p.v !== undefined)
    .map((p) => ({ t: p.t, v: r1(p.v) }));
  const vals = pts.length ? pts.map((p) => p.v) : pct !== undefined ? [r1(pct)] : [];
  const n = vals.length;
  if (!n) return { pct, samples: 0, maxRun: 0, pressure: false };
  const high = vals.map((v) => v >= CPU_PRESSURE_PCT);
  let maxRun = 0;
  let run = 0;
  let runStart: number | undefined;
  high.forEach((h, i) => {
    run = h ? run + 1 : 0;
    if (run > maxRun) maxRun = run;
    if (run === PRESSURE_RUN && runStart === undefined) runStart = i - PRESSURE_RUN + 1;
  });
  const highShare = high.filter(Boolean).length / n;
  const spikeIdx = vals.findIndex((v) => v >= CPU_SPIKE_PCT);
  const byShare = n >= MIN_SHARE_SAMPLES && highShare >= PRESSURE_SHARE;
  const pressure = maxRun >= PRESSURE_RUN || byShare || spikeIdx >= 0;
  const sustained = pts.length >= 3 ? vals.filter((v) => v >= CPU_HIGH_PCT).length / n >= SUSTAINED_SHARE : undefined;
  const onsetIdx = !pressure ? undefined : runStart ?? (spikeIdx >= 0 ? spikeIdx : high.indexOf(true));
  return {
    pct,
    peakPct: Math.max(...vals),
    samples: n,
    highShare,
    maxRun,
    sustained,
    pressure,
    ...(pts.length && onsetIdx !== undefined ? { onsetSec: pts[onsetIdx].t } : {}),
  };
}

/**
 * Latency symptom that corroborates CPU pressure: probe timeout, slow probe (>= SLOW_PROBE_MS), probe 5xx, 5xx in the
 * access log, or at least two slow requests in the access log. Connection refusals/DNS errors are not latency.
 */
export function cpuCorroboration(ctx: Pick<ExtractContext, "probe" | "logs">): string | undefined {
  const p = ctx.probe;
  if (p && !/^(?:no_url|blocked_address|rate_limited)$/.test(p.error ?? "")) {
    if (p.error === "timeout") return "probe_timeout";
    if (p.status !== undefined && p.status >= 500) return "probe_5xx";
    if (!p.error && p.latencyMs >= SLOW_PROBE_MS) return "probe_slow";
  }
  if (accessStats(ctx.logs).s5xx > 0) return "http_5xx";
  if (ctx.logs.filter((l) => (accessLatencyMs(l.message) ?? 0) >= SLOW_PROBE_MS).length >= 2) return "slow_requests";
  return undefined;
}

/**
 * Pre-onset baseline over EVERY applet's samples (a release always starts a new container, so "CPU was calm before
 * the release" can only come from the previous container): the first high sample and, when at least two calm
 * samples precede it, the first calm one.
 */
function baseline(m: MetricFacts, plan: PlanLimits | undefined): { firstHighSec?: number; calmSinceSec?: number } {
  const series = m.cpuApplets?.length ? m.cpuApplets.map((a) => a.points) : m.cpuSeries ? [m.cpuSeries] : [];
  const pts = series.flat().map((p) => ({ t: sec(p.t), v: cpuPct(p.v, plan) })).filter((p): p is { t: number; v: number } => p.v !== undefined);
  const highs = pts.filter((p) => r1(p.v) >= CPU_PRESSURE_PCT).map((p) => p.t);
  if (!highs.length) return {};
  const firstHighSec = Math.min(...highs);
  const calm = pts.filter((p) => p.t < firstHighSec).map((p) => p.t);
  return { firstHighSec, ...(calm.length >= 2 ? { calmSinceSec: Math.min(...calm) } : {}) };
}

const isoSec = (s: number | undefined) => (s === undefined ? undefined : toIso(s * 1000));

/** The dominant slow request path in the access log and whether its first slow request starts near the CPU onset. */
function slowPath(ctx: ExtractContext, onsetMs: number | undefined): DraftObservation | undefined {
  const slow = ctx.logs
    .map((l) => ({ l, ms: accessLatencyMs(l.message), path: parseAccessLine(l.message)?.path?.split("?")[0] }))
    .filter((x): x is typeof x & { ms: number; path: string } => x.ms !== undefined && x.ms >= SLOW_PROBE_MS && Boolean(x.path));
  if (slow.length < SLOW_PATH_MIN) return undefined;
  const counts = new Map<string, number>();
  for (const x of slow) counts.set(x.path, (counts.get(x.path) ?? 0) + 1);
  const [path, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (count < SLOW_PATH_MIN || count / slow.length < SLOW_PATH_SHARE) return undefined;
  const first = slow.filter((x) => x.path === path && x.l.ms !== undefined).sort((a, b) => (a.l.ms ?? 0) - (b.l.ms ?? 0))[0];
  const deltaSec = first?.l.ms !== undefined && onsetMs !== undefined ? Math.round((first.l.ms - onsetMs) / 1000) : undefined;
  const correlated = deltaSec !== undefined && deltaSec >= -PATH_ONSET_BEFORE_SEC && deltaSec <= PATH_ONSET_AFTER_SEC;
  return draft("http_status", "liara:logs", CPU_PATH_SUMMARY, "warn", (first ?? slow[0]).l.message, {
    path,
    slowCount: count,
    slowSharePct: (count / slow.length) * 100,
    firstSlowTs: first?.l.ts,
    cpuOnsetTs: onsetMs !== undefined ? toIso(onsetMs) : undefined,
    deltaSec,
    correlated,
    [SIG]: false,
  }, first?.l.ts);
}

export function extractMetric(ctx: ExtractContext): DraftObservation[] {
  const m = ctx.metrics;
  if (!m) return [];
  const out: DraftObservation[] = [];
  const plan = ctx.plan;
  let pathObs: DraftObservation | undefined;

  if (m.cpuCores !== undefined || m.cpuSeries?.length) {
    const c = cpuStats(m, plan);
    const corroboration = c.pressure ? cpuCorroboration(ctx) : undefined;
    const sig = c.pressure && (Boolean(corroboration) || c.sustained === true);
    const raw = c.pct === undefined && c.peakPct === undefined;
    const summary = raw
      ? "evidence.metric.cpu_raw"
      : sig
        ? c.sustained ? "evidence.metric.cpu_sustained_high" : "evidence.metric.cpu_high"
        : c.pressure || (c.peakPct ?? 0) >= CPU_PRESSURE_PCT ? "evidence.metric.cpu_elevated" : "evidence.metric.cpu_normal";
    const severity = sig ? "error" : c.pressure && (c.peakPct ?? 0) >= CPU_HIGH_PCT ? "warn" : "info";
    // The onset is only a time when calm samples precede it (else it lies before the window).
    const b = sig ? baseline(m, plan) : {};
    const onsetSec = sig && c.onsetSec !== undefined && hasCalmBefore(m, plan, c.onsetSec) ? c.onsetSec : undefined;
    const peakCores = c.peakPct !== undefined && plan?.cpu ? (c.peakPct / 100) * plan.cpu : undefined;
    const pctText = (p: number | undefined) => (p === undefined ? "" : ` (${Math.round(p)}% of plan)`);
    const text = [
      `cpu=${m.cpuCores ?? "?"} cores${plan?.cpu ? ` / plan ${plan.cpu} cores` : ""}${pctText(c.pct)}`,
      c.samples > 1 && peakCores !== undefined ? `peak ${Math.round(peakCores * 1000) / 1000} cores${pctText(c.peakPct)}` : "",
      c.samples > 1 && c.highShare !== undefined ? `${Math.round(c.highShare * c.samples)}/${c.samples} samples >= ${CPU_PRESSURE_PCT}% of plan, longest run ${c.maxRun}` : "",
      corroboration ? `latency symptom: ${corroboration}` : c.pressure ? "no latency symptom" : "",
    ].filter(Boolean).join("; ");
    out.push(
      draft("metric", "liara:metrics", summary, severity, text, {
        metric: "cpu",
        cpuCores: m.cpuCores,
        planCpu: plan?.cpu,
        cpuPct: c.pct,
        peakPct: c.peakPct,
        samples: c.samples,
        highSharePct: c.highShare !== undefined ? c.highShare * 100 : undefined,
        sustainedSamples: c.maxRun,
        sustained: c.sustained,
        pressure: c.pressure,
        corroborated: Boolean(corroboration),
        corroboration,
        applets: m.cpuApplets?.length ?? (m.cpuSeries ? 1 : undefined),
        onsetTs: isoSec(onsetSec),
        firstHighTs: isoSec(b.firstHighSec),
        calmSinceTs: isoSec(b.calmSinceSec),
        [SIG]: sig,
      }, isoSec(onsetSec)),
    );
    if (sig) pathObs = slowPath(ctx, onsetSec !== undefined ? onsetSec * 1000 : undefined);
  }

  if (m.memBytes !== undefined || m.memSeries?.length) {
    const s = memStats(m, plan);
    const near = (s.pct ?? 0) >= MEM_NEAR_LIMIT_PCT;
    const growing = (s.slopePctPerMin ?? 0) > 0.5 && (s.pct ?? 0) >= MEM_HIGH_PCT;
    const summary = s.pct === undefined ? "evidence.metric.memory_raw" : near ? "evidence.metric.memory_near_limit" : growing ? "evidence.metric.memory_growing" : (s.pct ?? 0) >= MEM_HIGH_PCT ? "evidence.metric.memory_high" : "evidence.metric.memory_normal";
    out.push(
      draft("metric", "liara:metrics", summary, near ? "error" : growing || (s.pct ?? 0) >= MEM_HIGH_PCT ? "warn" : "info",
        `memory=${m.memBytes ?? "?"} bytes${plan?.ramGb ? ` / plan ${plan.ramGb} GB` : ""}${s.pct !== undefined ? ` (${Math.round(s.pct)}% of plan)` : ""}`,
        {
          metric: "memory",
          memBytes: m.memBytes,
          planRamGb: plan?.ramGb,
          memPct: s.pct,
          slopePctPerMin: s.slopePctPerMin,
          nearLimit: near,
          growing,
          samples: s.samples,
          // RAM is only a signature near the limit (>= 85%) or when it keeps growing above 70%; it becomes a
          // hypothesis only together with an OOM observation (hypotheses-rules.ts, cause `oom`).
          [SIG]: near || growing,
        }),
    );
  }
  if (pathObs) out.push(pathObs);
  return out;
}

/** A calm sample (any applet) strictly before `onsetSec`. */
function hasCalmBefore(m: MetricFacts, plan: PlanLimits | undefined, onsetSec: number): boolean {
  const series = m.cpuApplets?.length ? m.cpuApplets.map((a) => a.points) : m.cpuSeries ? [m.cpuSeries] : [];
  return series.flat().some((p) => sec(p.t) < onsetSec && r1(cpuPct(p.v, plan) ?? Infinity) < CPU_PRESSURE_PCT);
}

export function memStats(m: MetricFacts | undefined, plan: PlanLimits | undefined) {
  const pct = memPct(m?.memBytes, plan);
  const pts = (m?.memSeries ?? [])
    .map((p) => ({ t: sec(p.t) / 60, v: memPct(p.v, plan) }))
    .filter((p): p is { t: number; v: number } => p.v !== undefined);
  const slopePctPerMin = slope(pts);
  return { pct, slopePctPerMin, samples: pts.length };
}
