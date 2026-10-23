// Server-side bodies of the read-only tools. Each read is turned into Observations by the evidence
// engine's own pure analyzers (same extractors as PASS 1), then appended to the run ledger.
import {
  getApp,
  getAppEventsFeed,
  getAppMetricSeries,
  getAppMetricsSummary,
  getBuildLogPages,
  getDatabase,
  getDatabaseMetricsSummary,
  getRelease,
  getRuntimeLogs,
  listApplets,
  listReleases,
  redactDatabase,
  type AppDetail,
  type LiaraClient,
} from "@/lib/liara";
import { probeApp } from "@/lib/canvas/probe";
import { analyzeApp, analyzeDb, type AppReads, type DbReads } from "@/lib/evidence/analyze";
import { stripAnsi } from "@/lib/evidence/lines";
import { TEMPORAL_SUMMARY } from "@/lib/evidence/temporal";
import type { Observation, ObservationSource, PlanLimits, SourceName } from "@/lib/evidence/types";

export interface ReadTarget {
  kind: "app" | "db";
  name: string;
  /** Liara id of a database (action endpoints use it); falls back to the hostname. */
  dbRef?: string;
}

export interface ReadEnv {
  liara: LiaraClient;
  target: ReadTarget;
  now: () => number;
  knownSecrets: readonly string[];
  probe: typeof probeApp;
  plan?: PlanLimits;
  signal?: AbortSignal;
  /** Cached app detail (env values are used only to scrub, never returned). */
  app?: AppDetail;
}

export interface ReadResult {
  observations: Observation[];
  /** Redacted raw lines the model may read (flag filtering happens in tools.ts). */
  lines: string[];
  /** Small structured facts for the model (no env values). */
  facts: Record<string, string | number | boolean | null>;
}

const MAX_RELEASE_LOOKUP = 20;
/** Env KEY NAMES are user-controlled text: only well-formed identifiers reach the model, capped. */
const ENV_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_MODEL_ENV_KEYS = 40;

/**
 * Observation sources each read may contribute. The analyzers run on a partial picture, so anything they
 * infer about sources this read did not touch (e.g. "no applets" when applets were not read, or a time
 * correlation without the release list) would be fabricated absence: it is dropped.
 */
const OWN_SOURCES: Record<SourceName, readonly ObservationSource[]> = {
  app: ["liara:app"],
  applets: ["liara:applets"],
  releases: ["liara:releases"],
  release_detail: ["liara:releases"],
  build_logs: ["liara:build-logs"],
  events: ["liara:events"],
  runtime_logs: ["liara:logs"],
  metrics_summary: ["liara:metrics"],
  metrics_series: ["liara:metrics"],
  probe: ["probe"],
  plan: [],
  databases: [],
  db_detail: ["liara:db"],
  db_list: ["liara:db"],
  db_metrics: ["liara:metrics"],
  db_events: ["liara:events"],
};

const own = (source: SourceName, obs: readonly Observation[]) =>
  obs.filter((o) => OWN_SOURCES[source].includes(o.source) && o.summary !== TEMPORAL_SUMMARY);

function appReads(env: ReadEnv, source: SourceName, extra: Partial<AppReads>, windowMin?: number): Observation[] {
  const reads: AppReads = {
    name: env.target.name,
    now: env.now(),
    ...(windowMin ? { windowMin } : {}),
    sources: [{ source, status: "ok" }],
    ...(env.app ? { app: env.app } : {}),
    ...(env.plan ? { plan: env.plan } : {}),
    knownSecrets: env.knownSecrets,
    ...extra,
  };
  return own(source, analyzeApp(reads).observations);
}

function dbReads(env: ReadEnv, source: SourceName, extra: Partial<DbReads>): Observation[] {
  return own(source, analyzeDb({ hostnameOrId: env.target.name, now: env.now(), sources: [{ source, status: "ok" }], knownSecrets: env.knownSecrets, ...extra }).observations);
}

/** Only releases of the investigated app may be read (no cross-app access through ids). */
async function ownedRelease(env: ReadEnv, releaseId?: string) {
  const page = await listReleases(env.liara, env.target.name, { page: 1, count: MAX_RELEASE_LOOKUP });
  const sorted = [...page.releases].sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0));
  const hit = releaseId ? sorted.find((r) => r._id === releaseId) : sorted[0];
  return { page, release: hit };
}

export const READS = {
  async get_app_status(env: ReadEnv): Promise<ReadResult> {
    const app = await getApp(env.liara, env.target.name);
    env.app = app;
    const keys = (app.envs ?? []).map((e) => e.key);
    const wellFormed = keys.filter((k): k is string => typeof k === "string" && ENV_KEY_NAME.test(k));
    return {
      observations: appReads(env, "app", { app }),
      // Key names go to the model only as untrusted LINES (wrapped and injection-filtered in tools.ts), never as
      // facts; malformed names are dropped and counted.
      lines: wellFormed.slice(0, MAX_MODEL_ENV_KEYS).map((k) => `env_key ${k}`),
      facts: {
        status: app.status ?? null,
        scale: app.scale ?? null,
        planID: app.planID ?? null,
        platform: app.type ?? null,
        envKeyCount: keys.length,
        envKeysListed: Math.min(wellFormed.length, MAX_MODEL_ENV_KEYS),
        envKeysMalformed: keys.length - wellFormed.length,
      },
    };
  },
  async get_applets(env: ReadEnv): Promise<ReadResult> {
    const applets = await listApplets(env.liara, env.target.name);
    return { observations: appReads(env, "applets", { applets }), lines: applets.slice(0, 10).map((a) => `${a.name ?? "?"} ${a.state ?? "?"} ${a.reason ?? ""} ${a.release?.tag ?? ""}`.trim()), facts: { applets: applets.length } };
  },
  async list_releases(env: ReadEnv): Promise<ReadResult> {
    const page = await listReleases(env.liara, env.target.name, { page: 1, count: 10 });
    return {
      observations: appReads(env, "releases", { releases: page }),
      lines: page.releases.map((r) => `${r._id ?? "?"} tag=${r.tag ?? "?"} state=${r.state ?? "?"} createdAt=${r.createdAt ?? "?"}`),
      facts: { total: page.total ?? page.releases.length, currentRelease: page.currentRelease ?? null },
    };
  },
  async get_release(env: ReadEnv, input: { releaseId?: string }): Promise<ReadResult> {
    const { page, release } = await ownedRelease(env, input.releaseId);
    if (!release?._id) return { observations: [], lines: [], facts: { found: false } };
    const detail = await getRelease(env.liara, release._id, env.signal);
    return {
      observations: appReads(env, "release_detail", { releases: page, releaseDetail: detail }),
      lines: [`${detail._id ?? "?"} tag=${detail.tag ?? "?"} state=${detail.state ?? "?"} port=${detail.port ?? "?"} failReason=${detail.failReason ?? ""}`],
      facts: { found: true },
    };
  },
  async get_runtime_logs(env: ReadEnv, input: { minutes: number }): Promise<ReadResult> {
    const startSec = Math.floor(env.now() / 1000) - input.minutes * 60;
    const { lines } = await getRuntimeLogs(env.liara, env.target.name, { startSec, ...(env.signal ? { signal: env.signal } : {}) });
    return { observations: appReads(env, "runtime_logs", { logs: lines }, input.minutes), lines: lines.slice(-400).map((l) => `${l.ts} ${l.stream} ${l.message}`), facts: { lines: lines.length } };
  },
  async get_build_logs(env: ReadEnv, input: { releaseId?: string }): Promise<ReadResult> {
    const { page, release } = await ownedRelease(env, input.releaseId);
    if (!release?._id) return { observations: [], lines: [], facts: { found: false } };
    const build = await getBuildLogPages(env.liara, release._id, { maxPages: 10, maxLines: 2000, ...(env.signal ? { signal: env.signal } : {}) });
    return {
      observations: appReads(env, "build_logs", { releases: page, buildLogs: build }),
      lines: build.buildOutput.slice(-300).map((b) => `${b.stream ?? ""} ${stripAnsi(b.line ?? "")}`.trim()),
      facts: { found: true, lines: build.buildOutput.length, state: release.state ?? null },
    };
  },
  async get_events(env: ReadEnv, input: { minutes: number }): Promise<ReadResult> {
    const end = Math.floor(env.now() / 1000);
    const feed = await getAppEventsFeed(env.liara, env.target.name, { start: end - input.minutes * 60, end });
    const events = feed.lines;
    return { observations: appReads(env, "events", { events, lifecycle: feed.lifecycle }, input.minutes), lines: events.slice(-100).map((e) => `${e.ts} ${e.message}`), facts: { events: events.length } };
  },
  async get_metrics(env: ReadEnv, input: { minutes: number }): Promise<ReadResult> {
    const since = Math.floor(env.now() / 1000) - input.minutes * 60;
    const [summary, cpu, mem] = await Promise.all([
      getAppMetricsSummary(env.liara, env.target.name),
      getAppMetricSeries(env.liara, env.target.name, "cpu", since).catch(() => undefined),
      getAppMetricSeries(env.liara, env.target.name, "memory", since).catch(() => undefined),
    ]);
    return { observations: appReads(env, "metrics_summary", { metricsSummary: summary, ...(cpu ? { cpuSeries: cpu } : {}), ...(mem ? { memSeries: mem } : {}) }, input.minutes), lines: [], facts: { series: Boolean(cpu || mem) } };
  },
  async probe_site(env: ReadEnv): Promise<ReadResult> {
    // SSRF safety lives in lib/canvas/probe: only the app's own Liara/custom domain is ever requested.
    const probe = await env.probe(env.liara, env.target.name);
    return { observations: appReads(env, "probe", { probe }), lines: [], facts: { ok: probe.ok, status: probe.status ?? null, latencyMs: probe.latencyMs, error: probe.error ?? null } };
  },
  async get_db_status(env: ReadEnv): Promise<ReadResult> {
    const detail = redactDatabase(await getDatabase(env.liara, env.target.dbRef ?? env.target.name));
    return { observations: dbReads(env, "db_detail", { detail }), lines: [], facts: { status: detail.status ?? null, scale: detail.scale ?? null, publicNetwork: detail.publicNetwork ?? null } };
  },
  async get_db_metrics(env: ReadEnv): Promise<ReadResult> {
    const summary = await getDatabaseMetricsSummary(env.liara, env.target.dbRef ?? env.target.name);
    return { observations: dbReads(env, "db_metrics", { metricsSummary: summary }), lines: [], facts: {} };
  },
} as const;

export type ReadToolName = keyof typeof READS;
export const APP_READ_TOOLS: readonly ReadToolName[] = ["get_app_status", "get_applets", "list_releases", "get_release", "get_runtime_logs", "get_build_logs", "get_events", "get_metrics", "probe_site"];
export const DB_READ_TOOLS: readonly ReadToolName[] = ["get_db_status", "get_db_metrics"];
