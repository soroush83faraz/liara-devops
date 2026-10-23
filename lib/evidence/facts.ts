// Maps lenient Liara shapes onto the small fact types the extractors use. Pure. Env VALUES are dropped here.
import type { Applet, AppDetail, DatabaseDetail, DatabaseSummary, MetricSeries, MetricsSummary, Release } from "@/lib/liara/schemas";
import { latestUsage, normalizeSeries } from "@/lib/liara/metrics";
import type { AppFacts, AppletFacts, DbFacts, MetricFacts, ReleaseFacts } from "./types";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function appFacts(app: AppDetail, fallbackName: string, configuredPort?: number): AppFacts {
  // Liara's detail may carry a `port` field (loose schema) [VAL]; the current release's port wins.
  const detailPort = (app as Record<string, unknown>).port;
  const port = configuredPort ?? (typeof detailPort === "number" ? detailPort : undefined);
  return {
    name: app.project_id ?? fallbackName,
    ...(app.type ? { platform: app.type } : {}),
    ...(app.status ? { status: app.status } : {}),
    ...(app.scale !== undefined ? { scale: app.scale } : {}),
    ...(app.planID ? { planId: app.planID } : {}),
    ...(port !== undefined ? { configuredPort: port } : {}),
    envKeys: [...new Set((app.envs ?? []).map((e) => e.key).filter((k) => ENV_KEY.test(k)))].sort(),
    ...(app.network?._id ? { networkId: app.network._id } : {}),
    ...(app.network?.name ? { networkName: app.network.name } : {}),
  };
}

export function appletFacts(a: Applet): AppletFacts {
  return {
    ...(a.name ? { name: a.name } : {}),
    ...(a.state ? { state: a.state } : {}),
    ...(a.reason ? { reason: a.reason } : {}),
    ...(a.timestamp ? { timestamp: a.timestamp } : {}),
    ...(a.release?.tag ? { releaseTag: a.release.tag } : {}),
  };
}

export function releaseFacts(r: Release): ReleaseFacts {
  return {
    ...(r._id ? { id: r._id } : {}),
    ...(r.tag ? { tag: r.tag } : {}),
    ...(r.state ? { state: r.state.toUpperCase() } : {}),
    ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
    ...(r.failReason ? { failReason: r.failReason } : {}),
    ...(r.port !== undefined ? { port: r.port } : {}),
  };
}

/** Newest first by createdAt (stable for equal/missing dates). */
export function sortReleases(rs: readonly ReleaseFacts[]): ReleaseFacts[] {
  return [...rs].sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0));
}

const maxOf = (xs: number[]) => (xs.length ? Math.max(...xs) : undefined);

type Pt = { t: number; v: number };
const sortPts = (pts: readonly Pt[]): Pt[] => [...pts].sort((a, b) => a.t - b.t);

/**
 * CPU applet choice (rolling restarts, documented in docs/architecture.md): the applet whose newest sample is the most
 * recent, i.e. the container serving now (ties: more samples, then the higher peak, then API order). Series are never
 * summed: the plan's CPU limit applies per container, so a sum of an outgoing and an incoming container would overstate
 * the pressure against that limit, and splicing two containers would invent a "sustained" run neither of them had.
 */
export function pickCurrentApplet<T extends { applet?: string; points: Pt[] }>(all: readonly T[]): T | undefined {
  let best: T | undefined;
  const last = (x: T) => x.points.reduce((m, p) => Math.max(m, p.t), Number.NEGATIVE_INFINITY);
  const peak = (x: T) => x.points.reduce((m, p) => Math.max(m, p.v), Number.NEGATIVE_INFINITY);
  for (const x of all) {
    if (!x.points.length) continue;
    if (!best || last(x) > last(best) || (last(x) === last(best) && (x.points.length > best.points.length || (x.points.length === best.points.length && peak(x) > peak(best))))) best = x;
  }
  return best;
}

/**
 * CPU: series and "current" value of the applet serving now (see `pickCurrentApplet`); every applet's series is kept
 * in `cpuApplets` only to tell whether CPU was calm BEFORE a release. Memory: the busiest applet (a container killed
 * near its memory limit is evidence of memory pressure even after its replacement started). Units are [VAL].
 */
export function metricFacts(summary?: MetricsSummary, cpu?: MetricSeries, mem?: MetricSeries): MetricFacts | undefined {
  const cpuLatest = summary ? latestUsage(summary.cpuUsage) : [];
  let memBytes = summary ? maxOf(latestUsage(summary.memoryUsage).map((s) => s.value)) : undefined;
  const cpuAll = (cpu ? normalizeSeries(cpu) : []).filter((x) => x.points.length).map((x) => ({ ...(x.applet ? { applet: x.applet } : {}), points: sortPts(x.points) }));
  const cur = pickCurrentApplet(cpuAll);
  const cpuSeries = cur?.points;
  // The summary value of the same applet when it is listed; else the max over applets (no series to choose by).
  let cpuCores = cur?.applet !== undefined && cpuLatest.some((s) => s.applet === cur.applet) ? cpuLatest.find((s) => s.applet === cur.applet)?.value : maxOf(cpuLatest.map((s) => s.value));
  // Memory: one series per applet; use the busiest applet's samples (deterministic: first max).
  const memAll = mem ? normalizeSeries(mem) : [];
  let best = memAll[0];
  for (const x of memAll) if (x.points.length && (maxOf(x.points.map((p) => p.v)) ?? 0) > (maxOf(best?.points.map((p) => p.v) ?? []) ?? 0)) best = x;
  const memSeries = best?.points.length ? sortPts(best.points) : undefined;
  // Without a summary, the newest series sample stands in for "current".
  if (cpuCores === undefined && cpuSeries) cpuCores = cpuSeries[cpuSeries.length - 1].v;
  if (memBytes === undefined && memSeries) memBytes = memSeries[memSeries.length - 1].v;
  if (cpuCores === undefined && memBytes === undefined && !cpuSeries && !memSeries) return undefined;
  return {
    ...(cpuCores !== undefined ? { cpuCores } : {}),
    ...(memBytes !== undefined ? { memBytes } : {}),
    ...(cpuSeries ? { cpuSeries } : {}),
    ...(cpuAll.length > 1 ? { cpuApplets: cpuAll } : {}),
    ...(memSeries ? { memSeries } : {}),
  };
}

export function dbFacts(d: DatabaseSummary | DatabaseDetail, fallbackHostname: string): DbFacts {
  const detail = d as Partial<DatabaseDetail>;
  return {
    hostname: d.hostname ?? fallbackHostname,
    ...(d._id ?? d.id ?? d.DBId ? { id: d._id ?? d.id ?? d.DBId } : {}),
    ...(d.type ? { engine: d.type } : {}),
    ...(d.status ? { status: d.status } : {}),
    ...(d.scale !== undefined ? { scale: d.scale } : {}),
    ...(d.publicNetwork !== undefined ? { publicNetwork: d.publicNetwork } : {}),
    ...(detail.network?._id ? { networkId: detail.network._id } : {}),
    ...(detail.network?.name ? { networkName: detail.network.name } : {}),
    ...(detail.port !== undefined ? { port: detail.port } : {}),
    ...(d.internalPort !== undefined ? { internalPort: d.internalPort } : {}),
  };
}
