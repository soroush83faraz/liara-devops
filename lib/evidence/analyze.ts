// Pure analysis: PASS-1 read results -> EvidenceBundle. No IO; same input -> identical output.
import type { AppLifecycleEvent } from "@/lib/liara/events";
import type { LogLine } from "@/lib/liara/logs";
import type { Applet, AppDetail, BuildLogsResponse, DatabaseDetail, DatabaseSummary, MetricSeries, MetricsSummary, Release, ReleasesPage } from "@/lib/liara/schemas";
import type { ProbeResult } from "@/lib/canvas/types";
import { LOG_EXTRACTORS, runExtractors } from "./extract";
import { appFacts, appletFacts, dbFacts, metricFacts, releaseFacts, sortReleases } from "./facts";
import { fill, LIMITS_FA, UNKNOWN_FA } from "./fa-templates";
import { groupLines, MAX_LINES, stripAnsi, toEvidenceLine } from "./lines";
import { assignIds, cleanParams, SIG } from "./observe";
import { buildRedactor, redactBundle } from "./redact-bundle";
import { buildTimeline, collectChanges, correlate, detectOnset, temporalObservations, type Onset } from "./temporal";
import { NOT_APPLICABLE, type AppFacts, type DbAppRef, type DbFacts, type DraftObservation, type EvidenceBundle, type EvidenceLine, type EvidenceUnknown, type ExtractContext, type PlanLimits, type ReleaseFacts, type SourceStatus } from "./types";

export const DEFAULT_WINDOW_MIN = 15;
/** `SourceStatus.error` of an `ok` build-log read that stopped early (page/line cap or a failed later page). */
export const BUILD_LOGS_PARTIAL = "partial";

export interface AppReads {
  name: string;
  now: number;
  windowMin?: number;
  sources: SourceStatus[];
  app?: AppDetail;
  applets?: Applet[];
  releases?: ReleasesPage;
  releaseDetail?: Release;
  buildLogs?: BuildLogsResponse;
  events?: LogLine[];
  /** Structured container lifecycle events of the same events response. */
  lifecycle?: AppLifecycleEvent[];
  logs?: LogLine[];
  metricsSummary?: MetricsSummary;
  cpuSeries?: MetricSeries;
  memSeries?: MetricSeries;
  probe?: ProbeResult;
  plan?: PlanLimits;
  dbs?: DbFacts[];
  knownSecrets?: readonly string[];
}

export interface DbReads {
  hostnameOrId: string;
  now: number;
  windowMin?: number;
  sources: SourceStatus[];
  summary?: DatabaseSummary;
  detail?: DatabaseDetail;
  metricsSummary?: MetricsSummary;
  events?: LogLine[];
  apps?: DbAppRef[];
  knownSecrets?: readonly string[];
}

type Line = { ts?: string; stream?: string; message: string; releaseId?: string };

function lines(src: readonly Line[] | undefined, redact: (s: string) => string): { lines: EvidenceLine[]; capped: boolean } {
  const all = src ?? [];
  const kept = all.length > MAX_LINES ? all.slice(-MAX_LINES) : all;
  return { lines: kept.map((l) => toEvidenceLine(l, redact)), capped: all.length > MAX_LINES };
}

/** Merges list entries with the newest release's detail (detail wins on the same id). */
function releasesOf(page: ReleasesPage | undefined, detail: Release | undefined): ReleaseFacts[] {
  const list = (page?.releases ?? []).map(releaseFacts);
  if (detail) {
    const d = releaseFacts(detail);
    const i = list.findIndex((r) => r.id && r.id === d.id);
    if (i >= 0) list[i] = { ...list[i], ...d };
    else list.push(d);
  }
  return sortReleases(list);
}

/* ------------------------------------------------------------ release scope */

/** Where a runtime line's release stands relative to the release that serves traffic now. */
export type ReleaseRole = "current" | "newer" | "previous";

export interface ReleaseScope {
  current?: ReleaseFacts;
  currentId: string;
  /** Current + releases newer than it (failed/unhealthy/in-progress attempts): their output describes the present. */
  liveIds: string[];
  role(id: string | undefined): ReleaseRole | undefined;
}

/**
 * The serving release is the API's `currentRelease` (fallback: newest READY). Lines of that release and of newer
 * releases are "live"; lines of any other release (older, or not in the newest page of releases) are history.
 * Without a known current release there is no scoping and every line counts (previous behaviour).
 */
export function releaseScope(releases: readonly ReleaseFacts[], currentReleaseId: string | undefined): ReleaseScope | undefined {
  const current = (currentReleaseId ? releases.find((r) => r.id === currentReleaseId) : undefined) ?? (currentReleaseId ? undefined : releases.find((r) => r.state === "READY"));
  const currentId = currentReleaseId ?? current?.id;
  if (!currentId) return undefined;
  // `releases` is newest first. A current release missing from the page is older than every listed one.
  const idx = current ? releases.indexOf(current) : releases.length;
  const newer = new Set(releases.slice(0, idx).flatMap((r) => (r.id ? [r.id] : [])));
  return {
    ...(current ? { current } : {}),
    currentId,
    liveIds: [currentId, ...newer],
    role: (id) => (!id ? undefined : id === currentId ? "current" : newer.has(id) ? "newer" : "previous"),
  };
}

/** Observations from previous releases kept per investigation (they are history, not diagnosis). */
export const MAX_HISTORICAL_OBSERVATIONS = 6;

/**
 * Runs the log extractors on the lines of previous releases and marks every result historical: info severity, never
 * a signature, `release: "previous"`, `historical: 1` and the release tag (the UI prefixes these, the hypothesis
 * rules ignore them).
 */
function historicalDrafts(ctx: ExtractContext, lines: readonly EvidenceLine[], releases: readonly ReleaseFacts[], app: AppFacts | undefined): DraftObservation[] {
  const byRelease = new Map<string, EvidenceLine[]>();
  for (const l of lines) {
    const k = l.releaseId ?? "";
    byRelease.set(k, [...(byRelease.get(k) ?? []), l]);
  }
  const out: DraftObservation[] = [];
  for (const [releaseId, ls] of byRelease) {
    const rel = releases.find((r) => r.id === releaseId);
    const hctx: ExtractContext = {
      mode: "app",
      now: ctx.now,
      windowMin: ctx.windowMin,
      ...(app ? { app: { ...app, ...(rel?.port !== undefined ? { configuredPort: rel.port } : {}) } } : {}),
      logs: ls,
      logGroups: groupLines(ls),
      buildLines: [],
      buildGroups: [],
      events: [],
      eventGroups: [],
      applets: [],
      appletsKnown: false,
      releases: [],
      dbs: ctx.dbs,
    };
    for (const d of runExtractors(hctx, LOG_EXTRACTORS)) {
      const rest: Record<string, string | number> = { ...d.params };
      for (const k of [SIG, "releaseTag", "releaseId"]) delete rest[k];
      out.push({
        ...d,
        severity: "info",
        params: cleanParams({ release: "previous", historical: true, releaseTag: rel?.tag, releaseId, ...rest, [SIG]: false }),
      });
    }
  }
  return out.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? "")).slice(-MAX_HISTORICAL_OBSERVATIONS);
}

/** Adds the release role/tag to observations built from runtime or build lines of a live release. */
function annotateRelease(d: DraftObservation, scope: ReleaseScope | undefined, releases: readonly ReleaseFacts[]): DraftObservation {
  if (!scope || (d.source !== "liara:logs" && d.source !== "liara:build-logs")) return d;
  const id = typeof d.params.releaseId === "string" ? d.params.releaseId : undefined;
  const role = scope.role(id);
  if (!role) return d;
  const tag = d.params.releaseTag ?? releases.find((r) => r.id === id)?.tag;
  const params = { ...d.params, release: role, ...(tag !== undefined ? { releaseTag: tag } : {}) };
  // Never trade an existing param (the signature marker is last) for the annotation.
  return Object.keys(params).length <= 24 ? { ...d, params } : d;
}

function unknownsFor(sources: readonly SourceStatus[], extra: EvidenceUnknown[]): EvidenceUnknown[] {
  const out: EvidenceUnknown[] = [];
  for (const s of sources) {
    if (s.status === "ok" || s.error === NOT_APPLICABLE) continue;
    const t = UNKNOWN_FA[s.source];
    out.push({ code: `source_${s.status}.${s.source}`, source: s.source, descriptionFa: t.description, howToGet: t.howToGet });
  }
  const seen = new Set<string>();
  return [...out, ...extra].filter((u) => !seen.has(u.code) && seen.add(u.code));
}

const unknown = (code: "http_status" | "logs_empty" | "plan_limits", p: Record<string, number> = {}): EvidenceUnknown => ({
  code: `missing.${code}`,
  descriptionFa: fill(UNKNOWN_FA[code].description, p),
  howToGet: UNKNOWN_FA[code].howToGet,
});

function finalize(
  target: EvidenceBundle["target"],
  ctx: ExtractContext,
  sources: SourceStatus[],
  drafts: DraftObservation[],
  onset: Onset,
  extraUnknowns: EvidenceUnknown[],
  limits: string[],
  raw: Record<string, unknown>,
  redactor: ReturnType<typeof buildRedactor>,
): EvidenceBundle {
  const changes = collectChanges(ctx);
  const all = [...drafts, ...temporalObservations(drafts, changes, onset)];
  const correlation = correlate(onset.onsetTs, changes, onset.releaseId);
  const bundle: EvidenceBundle = {
    target,
    collectedAt: new Date(ctx.now).toISOString(),
    windowMin: ctx.windowMin,
    sources,
    raw: {
      ...raw,
      onset: { firstErrorTs: onset.firstErrorTs, changePointTs: onset.changePointTs, onsetTs: onset.onsetTs, onsetSource: onset.onsetSource, atWindowStart: onset.atWindowStart },
      changes: changes.map((c) => ({ kind: c.kind, ts: c.ts, releaseTag: c.releaseTag, releaseId: c.releaseId })),
    },
    observations: assignIds(all),
    timeline: buildTimeline(ctx, changes, onset, drafts),
    ...(correlation ? { correlation } : {}),
    unknowns: unknownsFor(sources, extraUnknowns),
    limits: [...new Set(limits)],
  };
  return redactBundle(bundle, redactor);
}

export function analyzeApp(reads: AppReads): EvidenceBundle {
  const windowMin = reads.windowMin ?? DEFAULT_WINDOW_MIN;
  // Env values only feed the exact-match scrub list inside the redactor; they are not kept anywhere.
  const redactor = buildRedactor({ knownSecrets: reads.knownSecrets, envs: reads.app?.envs });
  const r = (s: string) => redactor.string(s);
  const logs = lines(reads.logs, r);
  // One build-output entry can hold several lines ("npm error code ETARGET\nnpm error notarget ..."), often coloured.
  const buildSrc = (reads.buildLogs?.buildOutput ?? []).flatMap((b) =>
    stripAnsi(b.line)
      .split("\n")
      .filter((part) => part.trim())
      .map((part) => ({ ts: b.createdAt, stream: b.stream, message: part, releaseId: b.releaseID })),
  );
  const build = lines(buildSrc, r);
  const events = lines(reads.events, r);
  const releases = releasesOf(reads.releases, reads.releaseDetail);
  const currentReleaseId = reads.releases?.currentRelease;
  const current = releases.find((x) => x.id && x.id === currentReleaseId) ?? releases.find((x) => x.state === "READY");
  const app = reads.app ? appFacts(reads.app, reads.name, current?.port ?? releases.find((x) => x.port !== undefined)?.port) : undefined;
  const metrics = metricFacts(reads.metricsSummary, reads.cpuSeries, reads.memSeries);

  // Runtime lines of older releases describe the past (all releases of the window share one log stream).
  const scope = releaseScope(releases, currentReleaseId);
  const isHistory = (l: EvidenceLine) => scope?.role(l.releaseId) === "previous";
  const liveLogs = logs.lines.filter((l) => !isHistory(l));
  const historyLogs = logs.lines.filter(isHistory);

  const ctx: ExtractContext = {
    mode: "app",
    now: reads.now,
    windowMin,
    ...(app ? { app } : {}),
    ...(reads.plan ? { plan: reads.plan } : {}),
    logs: liveLogs,
    logGroups: groupLines(liveLogs),
    buildLines: build.lines,
    buildGroups: groupLines(build.lines),
    events: events.lines,
    eventGroups: groupLines(events.lines),
    ...(reads.lifecycle ? { lifecycle: reads.lifecycle } : {}),
    applets: (reads.applets ?? []).map(appletFacts),
    appletsKnown: reads.applets !== undefined,
    releases,
    ...(currentReleaseId ? { currentReleaseId } : {}),
    ...(scope ? { liveReleaseIds: scope.liveIds } : {}),
    ...(metrics ? { metrics } : {}),
    ...(reads.probe ? { probe: reads.probe } : {}),
    dbs: reads.dbs ?? [],
  };

  const live = runExtractors(ctx).map((d) => annotateRelease(d, scope, releases));
  const history = historyLogs.length ? historicalDrafts(ctx, historyLogs, releases, app) : [];
  const drafts = [...live, ...history];
  const onset = detectOnset(ctx.logs, ctx.now, windowMin);
  const status = (s: string) => reads.sources.find((x) => x.source === s)?.status;

  const extra: EvidenceUnknown[] = [];
  if (status("runtime_logs") === "ok" && logs.lines.length === 0) extra.push(unknown("logs_empty", { windowMin }));
  if (status("runtime_logs") === "ok" && logs.lines.length > 0 && !drafts.some((d) => d.kind === "http_status")) extra.push(unknown("http_status"));
  if (ctx.metrics && !(ctx.plan?.cpu && ctx.plan?.ramGb) && status("plan") !== "failed") extra.push(unknown("plan_limits"));

  const limits = [fill(LIMITS_FA.window, { windowMin })];
  if (ctx.metrics) limits.push(LIMITS_FA.metricsUnits);
  if (releases.length >= 2) limits.push(LIMITS_FA.noRollback);
  if (onset.atWindowStart) limits.push(LIMITS_FA.onsetBeforeWindow);
  if (logs.capped) limits.push(fill(LIMITS_FA.linesCapped, { lines: MAX_LINES }));
  if (historyLogs.length) {
    const tags = [...new Set(historyLogs.map((l) => releases.find((x) => x.id === l.releaseId)?.tag ?? "?"))].join("، ");
    limits.push(fill(LIMITS_FA.previousReleaseLines, { count: historyLogs.length, tags, current: scope?.current?.tag ?? "?" }));
  }
  const buildRead = reads.sources.find((x) => x.source === "build_logs");
  if (buildRead?.error === BUILD_LOGS_PARTIAL) limits.push(LIMITS_FA.buildLogsPartial);
  if (reads.sources.some((s) => s.status === "failed")) limits.push(LIMITS_FA.partial);

  const raw = {
    app,
    applets: ctx.applets,
    releases,
    currentReleaseId,
    ...(scope ? { releaseScope: { currentReleaseId: scope.currentId, liveReleaseIds: scope.liveIds, historicalLines: historyLogs.length } } : {}),
    logGroups: ctx.logGroups.slice(0, 40).map(({ message, count, firstTs, lastTs, stream }) => ({ message, count, firstTs, lastTs, stream })),
    buildTail: ctx.buildLines.slice(-50),
    events: ctx.events.slice(-50),
    ...(ctx.lifecycle ? { lifecycle: ctx.lifecycle.slice(-50).map(({ ts, action, status, releaseId, tag }) => ({ ts: new Date(ts).toISOString(), action, status, releaseId, tag })) } : {}),
    metrics: ctx.metrics ? { ...ctx.metrics, cpuSeries: ctx.metrics.cpuSeries?.slice(-60), cpuApplets: ctx.metrics.cpuApplets?.slice(0, 4).map((a) => ({ ...a, points: a.points.slice(-60) })), memSeries: ctx.metrics.memSeries?.slice(-60) } : undefined,
    probe: ctx.probe,
    plan: ctx.plan,
    dbs: ctx.dbs,
    lineCounts: { logs: ctx.logs.length, historicalLogs: historyLogs.length, build: ctx.buildLines.length, events: ctx.events.length },
  };
  return finalize({ kind: "app", name: app?.name ?? reads.name }, ctx, reads.sources, drafts, onset, extra, limits, raw, redactor);
}

export function analyzeDb(reads: DbReads): EvidenceBundle {
  const windowMin = reads.windowMin ?? DEFAULT_WINDOW_MIN;
  const redactor = buildRedactor({ knownSecrets: reads.knownSecrets });
  const events = lines(reads.events, (s) => redactor.string(s));
  const base = reads.detail ?? reads.summary;
  const db = base ? { ...(reads.summary ? dbFacts(reads.summary, reads.hostnameOrId) : {}), ...dbFacts(base, reads.hostnameOrId) } : undefined;
  const metrics = metricFacts(reads.metricsSummary);
  const ctx: ExtractContext = {
    mode: "db",
    now: reads.now,
    windowMin,
    logs: [],
    logGroups: [],
    buildLines: [],
    buildGroups: [],
    events: events.lines,
    eventGroups: groupLines(events.lines),
    applets: [],
    releases: [],
    ...(metrics ? { metrics } : {}),
    dbs: db ? [db] : [],
    dbApps: reads.apps ?? [],
  };
  const drafts = runExtractors(ctx);
  const onset: Onset = { atWindowStart: false, buckets: [] };
  const limits = [fill(LIMITS_FA.window, { windowMin })];
  if (ctx.metrics) limits.push(LIMITS_FA.metricsUnits);
  if (reads.sources.some((s) => s.status === "failed")) limits.push(LIMITS_FA.partial);
  const raw = { db, apps: (reads.apps ?? []).map((a) => ({ app: a.app, envKey: a.envKey, networkId: a.networkId ?? null, hostKind: a.hostKind ?? "unknown" })), events: ctx.events.slice(-50), metrics: ctx.metrics };
  return finalize({ kind: "db", name: db?.hostname ?? reads.hostnameOrId }, ctx, reads.sources, drafts, onset, [], limits, raw, redactor);
}
