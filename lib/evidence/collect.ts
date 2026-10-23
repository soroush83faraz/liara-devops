// PASS-1 evidence collection (server-only IO). Every read is independent: a failure becomes a
// SourceStatus + explicit unknown, never an exception. Analysis is delegated to the pure `analyze*`.
import {
  getApp,
  getAppEventsFeed,
  getAppMetricSeries,
  getAppMetricsSummary,
  getBuildLogPages,
  getDatabase,
  getDatabaseEvents,
  getDatabaseMetricsSummary,
  getMe,
  getRelease,
  getRuntimeLogs,
  isLiaraError,
  listApplets,
  listAppPlans,
  listDatabases,
  listReleases,
  redactDatabase,
  type LiaraClient,
} from "@/lib/liara";
import type { MetricSeries } from "@/lib/liara/schemas";
import { probeApp } from "@/lib/canvas/probe";
import type { ProbeResult } from "@/lib/canvas/types";
import { analyzeApp, analyzeDb, BUILD_LOGS_PARTIAL, DEFAULT_WINDOW_MIN, type AppReads } from "./analyze";
import { dbFacts } from "./facts";
import { matchDb, parseConnection } from "./extract/connection";
import { NOT_APPLICABLE, type DbAppRef, type DbFacts, type EvidenceBundle, type PlanLimits, type SourceName, type SourceStatus } from "./types";

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

/** Stable error code only: upstream messages may echo request data and are never forwarded. */
export function errorCode(e: unknown): string {
  if (isLiaraError(e)) return e.status ? `${e.kind}_${e.status}` : e.kind;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "timeout";
  return "error";
}

async function settle<T>(p: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p() };
  } catch (e) {
    return { ok: false, error: errorCode(e) };
  }
}

const status = (source: SourceName, s: Settled<unknown> | undefined, count?: number): SourceStatus =>
  !s ? { source, status: "unavailable", error: NOT_APPLICABLE } : s.ok ? { source, status: "ok", ...(count !== undefined ? { count } : {}) } : { source, status: "failed", error: s.error };

/** Max DB details fetched for connection-error targets. */
const MAX_DB_DETAILS = 2;
/** Build logs are read only for releases in these states (the failure, or a build still running). */
const BUILD_LOG_STATES = /^(?:FAILED|TIMEDOUT|UNHEALTHY|CANCEL+ED|BUILDING)$/i;
/** Build-log paging caps: Liara returns ~20 lines per page. */
export const BUILD_LOG_MAX_PAGES = 10;
export const BUILD_LOG_MAX_LINES = 2000;

export interface CollectAppOptions {
  liara: LiaraClient;
  name: string;
  windowMin?: number;
  probe?: typeof probeApp;
  now?: () => number;
  /** Extra exact secrets to scrub (session token, known DB password...). */
  knownSecrets?: readonly string[];
  /** Plan limits when the caller already knows them (skips `GET /v1/me`). */
  plan?: PlanLimits;
  /** Known databases (skips `GET /v1/databases`). */
  dbs?: DbFacts[];
  /** Cancels the multi-page reads (build logs, runtime logs) of this run. */
  signal?: AbortSignal;
}

export async function collectAppEvidence(opts: CollectAppOptions): Promise<EvidenceBundle> {
  const { liara, name } = opts;
  const windowMin = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const now = (opts.now ?? Date.now)();
  const nowSec = Math.floor(now / 1000);
  const since = nowSec - windowMin * 60;
  const probe = opts.probe ?? probeApp;

  // PASS 1: all independent reads at once; the client's limiter caps real concurrency.
  const [app, applets, releases, events, logs, summary, cpu, mem, probed, me, dbList] = await Promise.all([
    settle(() => getApp(liara, name)),
    settle(() => listApplets(liara, name)),
    settle(() => listReleases(liara, name, { page: 1, count: 5 })),
    // Events cover a longer window so restarts/env changes before the log window are still seen.
    settle(() => getAppEventsFeed(liara, name, { start: nowSec - Math.max(windowMin, 60) * 60, end: nowSec })),
    settle(() => getRuntimeLogs(liara, name, { startSec: since, ...(opts.signal ? { signal: opts.signal } : {}) })),
    settle(() => getAppMetricsSummary(liara, name)),
    settle(() => getAppMetricSeries(liara, name, "cpu", since)),
    settle(() => getAppMetricSeries(liara, name, "memory", since)),
    settle<ProbeResult>(() => probe(liara, name)),
    opts.plan ? undefined : settle(() => getMe(liara)),
    opts.dbs ? undefined : settle(() => listDatabases(liara)),
  ]);

  // Newest release detail (+ build logs when it is not READY).
  const list = releases.ok ? releases.value.releases : [];
  const newest = [...list].sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0))[0];
  const needBuild = Boolean(newest?._id && BUILD_LOG_STATES.test(newest.state ?? ""));
  const [detail, build] = await Promise.all([
    newest?._id ? settle(() => getRelease(liara, newest._id as string)) : undefined,
    needBuild
      ? settle(() => getBuildLogPages(liara, newest!._id as string, { maxPages: BUILD_LOG_MAX_PAGES, maxLines: BUILD_LOG_MAX_LINES, ...(opts.signal ? { signal: opts.signal } : {}) }))
      : undefined,
  ]);

  // Plan limits from /v1/me (shape [VAL]).
  let plan = opts.plan;
  let planStatus: SourceStatus = opts.plan ? { source: "plan", status: "ok" } : { source: "plan", status: "unavailable" };
  if (!opts.plan && me) {
    if (!me.ok) planStatus = { source: "plan", status: "failed", error: me.error };
    else if (app.ok && app.value.planID) {
      const p = listAppPlans(me.value, { availableOnly: false, region: "any", includeLegacy: true }).find((x) => x.id === app.value.planID);
      if (p && (p.cpu || p.ramGb)) {
        plan = { ...(p.cpu ? { cpu: p.cpu } : {}), ...(p.ramGb ? { ramGb: p.ramGb } : {}) };
        planStatus = { source: "plan", status: "ok" };
      } else planStatus = { source: "plan", status: "unavailable", error: "plan_not_found" };
    } else planStatus = { source: "plan", status: "unavailable", error: "plan_id_unknown" };
  }

  // DBs named by connection errors (hostname match only; no env values are read).
  const facts: DbFacts[] = opts.dbs ?? (dbList?.ok ? dbList.value.flatMap((d) => (d.hostname ? [dbFacts(d, d.hostname)] : [])) : []);
  const targets = new Set<string>();
  for (const l of logs.ok ? logs.value.lines : []) {
    const db = matchDb(parseConnection(l.message)?.host, facts);
    if (db) targets.add(db.hostname);
    if (targets.size >= MAX_DB_DETAILS) break;
  }
  const relevant = facts.filter((d) => targets.has(d.hostname));
  const details = await Promise.all(relevant.map((d) => (d.id ? settle(() => getDatabase(liara, d.id as string)) : undefined)));
  const dbs = relevant.map((d, i) => {
    const r = details[i];
    // getDatabase strips root_password at parse time; redactDatabase is a second guard.
    return r?.ok ? { ...d, ...dbFacts(redactDatabase(r.value), d.hostname) } : d;
  });
  const fetched = details.filter((d): d is Settled<Awaited<ReturnType<typeof getDatabase>>> => d !== undefined);
  const failedDetail = fetched.find((d): d is { ok: false; error: string } => !d.ok);
  const dbDetailStatus: SourceStatus =
    fetched.length === 0
      ? { source: "db_detail", status: "unavailable", error: NOT_APPLICABLE }
      : failedDetail
        ? { source: "db_detail", status: "failed", error: failedDetail.error }
        : { source: "db_detail", status: "ok", count: fetched.length };

  const series = (s: Settled<MetricSeries>) => (s.ok ? s.value : undefined);
  const sources: SourceStatus[] = [
    status("app", app),
    status("applets", applets, applets.ok ? applets.value.length : undefined),
    status("releases", releases, list.length),
    status("release_detail", detail),
    build?.ok && build.value.partial
      ? { source: "build_logs", status: "ok", error: BUILD_LOGS_PARTIAL, count: build.value.buildOutput.length }
      : status("build_logs", build, build?.ok ? build.value.buildOutput.length : undefined),
    status("events", events, events.ok ? events.value.lines.length : undefined),
    status("runtime_logs", logs, logs.ok ? logs.value.lines.length : undefined),
    status("metrics_summary", summary),
    cpu.ok || mem.ok ? { source: "metrics_series", status: "ok" } : status("metrics_series", cpu),
    status("probe", probed),
    planStatus,
    opts.dbs ? { source: "databases", status: "ok", count: opts.dbs.length } : status("databases", dbList, dbList?.ok ? dbList.value.length : undefined),
    dbDetailStatus,
  ];

  const reads: AppReads = {
    name,
    now,
    windowMin,
    sources,
    ...(app.ok ? { app: app.value } : {}),
    ...(applets.ok ? { applets: applets.value } : {}),
    ...(releases.ok ? { releases: releases.value } : {}),
    ...(detail?.ok ? { releaseDetail: detail.value } : {}),
    ...(build?.ok ? { buildLogs: { ...(build.value.release ? { release: build.value.release } : {}), buildOutput: build.value.buildOutput } } : {}),
    ...(events.ok ? { events: events.value.lines, lifecycle: events.value.lifecycle } : {}),
    ...(logs.ok ? { logs: logs.value.lines } : {}),
    ...(summary.ok ? { metricsSummary: summary.value } : {}),
    ...(series(cpu) ? { cpuSeries: series(cpu) } : {}),
    ...(series(mem) ? { memSeries: series(mem) } : {}),
    ...(probed.ok ? { probe: probed.value } : {}),
    ...(plan ? { plan } : {}),
    dbs,
    ...(opts.knownSecrets ? { knownSecrets: opts.knownSecrets } : {}),
  };
  return analyzeApp(reads);
}

export interface CollectDbOptions {
  liara: LiaraClient;
  /** Database hostname (user-chosen name) or Liara id. */
  hostnameOrId: string;
  windowMin?: number;
  now?: () => number;
  /** Apps that reference this DB, as env KEY-only edges (e.g. from the canvas overview). */
  apps?: DbAppRef[];
  knownSecrets?: readonly string[];
}

export async function collectDbEvidence(opts: CollectDbOptions): Promise<EvidenceBundle> {
  const { liara, hostnameOrId } = opts;
  const windowMin = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const now = (opts.now ?? Date.now)();
  const nowSec = Math.floor(now / 1000);

  const list = await settle(() => listDatabases(liara));
  const summary = list.ok
    ? list.value.find((d) => d.hostname === hostnameOrId || d._id === hostnameOrId || d.id === hostnameOrId || d.DBId === hostnameOrId)
    : undefined;
  const ref = summary?._id ?? summary?.id ?? summary?.DBId ?? hostnameOrId;
  const hostname = summary?.hostname ?? hostnameOrId;

  const [detail, metrics, events] = await Promise.all([
    // `getDatabase` parses with a stripping schema: root_password never enters this process's data.
    settle(() => getDatabase(liara, ref)),
    settle(() => getDatabaseMetricsSummary(liara, ref)),
    settle(() => getDatabaseEvents(liara, hostname, { start: nowSec - Math.max(windowMin, 60) * 60, end: nowSec })),
  ]);

  const sources: SourceStatus[] = [
    list.ok && !summary ? { source: "db_list", status: "unavailable", error: "not_listed" } : status("db_list", list, list.ok ? list.value.length : undefined),
    status("db_detail", detail),
    status("db_metrics", metrics),
    status("db_events", events, events.ok ? events.value.length : undefined),
  ];
  return analyzeDb({
    hostnameOrId,
    now,
    windowMin,
    sources,
    ...(summary ? { summary: redactDatabase(summary) } : {}),
    ...(detail.ok ? { detail: redactDatabase(detail.value) } : {}),
    ...(metrics.ok ? { metricsSummary: metrics.value } : {}),
    ...(events.ok ? { events: events.value } : {}),
    ...(opts.apps ? { apps: opts.apps } : {}),
    ...(opts.knownSecrets ? { knownSecrets: opts.knownSecrets } : {}),
  });
}
