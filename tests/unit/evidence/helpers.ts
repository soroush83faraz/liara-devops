// Test doubles: a fake Liara backend (fetch) fed by synthetic scenario fixtures. No network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLiaraClient, type LiaraClient } from "@/lib/liara";
import type { ProbeResult } from "@/lib/canvas/types";
import type { DbAppRef, ExtractContext } from "@/lib/evidence/types";
import { groupLines, toEvidenceLine } from "@/lib/evidence/lines";

export const TEST_TOKEN = "synthetic-test-token-XYZ123456";

export interface Scenario {
  _note: string;
  scenario: string;
  now: string;
  name: string;
  app?: unknown;
  applets?: unknown;
  releases?: unknown;
  releaseDetails: Record<string, unknown>;
  buildLogs: Record<string, unknown>;
  events?: unknown;
  logs?: unknown;
  metricsSummary?: unknown;
  metricsCpu?: unknown;
  metricsMemory?: unknown;
  me?: unknown;
  databases?: unknown;
  databaseDetails: Record<string, unknown>;
  dbMetricsSummary?: unknown;
  dbEvents?: unknown;
  dbApps?: DbAppRef[];
  probe: ProbeResult;
  fail: Record<string, number>;
}

export const SCENARIOS = [
  "healthy",
  "missing-env",
  "wrong-port",
  "crash-loop",
  "oom",
  "cpu-bound-slow",
  "build-failure",
  "db-unreachable",
  "db-stopped",
  "injection-in-logs",
  "logs-unavailable",
  "partial-failure",
] as const;

export function loadScenario(name: string): Scenario {
  const path = join(__dirname, "../../fixtures/scenarios", `${name}.synthetic.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Scenario;
}

type Route = { key: string; re: RegExp; body: (s: Scenario, m: RegExpMatchArray, q: URLSearchParams) => unknown };

/** Live Liara (2026-10-23): at most 20 build-output lines per call. */
export const BUILD_LOG_PAGE_SIZE = 20;

/**
 * Serves a stored `{buildOutput}` like live Liara: 20 lines per call, `?since=<createdAt>` continues from that line.
 * The cursor is inclusive here (the boundary line comes again), so callers must de-duplicate by `_id`.
 */
export function pageBuildLogs(body: unknown, since: string | null): unknown {
  if (!body || typeof body !== "object" || !Array.isArray((body as { buildOutput?: unknown }).buildOutput)) return body;
  const all = (body as { buildOutput: Array<{ createdAt?: string }> }).buildOutput;
  const from = since ? all.filter((l) => Date.parse(l.createdAt ?? "") >= Date.parse(since)) : all;
  return { ...(body as object), buildOutput: from.slice(0, BUILD_LOG_PAGE_SIZE) };
}

const ROUTES: Route[] = [
  { key: "logs", re: /^\/v2\/projects\/[^/]+\/logs$/, body: (s) => s.logs },
  { key: "logsV1", re: /^\/v1\/projects\/[^/]+\/logs$/, body: () => undefined },
  { key: "applets", re: /^\/v1\/projects\/[^/]+\/applets$/, body: (s) => s.applets },
  { key: "releases", re: /^\/v1\/projects\/[^/]+\/releases$/, body: (s) => s.releases },
  { key: "events", re: /^\/v1\/projects\/[^/]+\/events$/, body: (s) => s.events },
  { key: "metricsSummary", re: /^\/v1\/projects\/[^/]+\/metrics\/summary$/, body: (s) => s.metricsSummary },
  { key: "metricsCpu", re: /^\/v1\/projects\/[^/]+\/metrics\/cpu$/, body: (s) => s.metricsCpu },
  { key: "metricsMemory", re: /^\/v1\/projects\/[^/]+\/metrics\/memory$/, body: (s) => s.metricsMemory },
  { key: "app", re: /^\/v1\/projects\/[^/]+$/, body: (s) => s.app },
  { key: "releaseDetail", re: /^\/v1\/releases\/([^/]+)$/, body: (s, m) => s.releaseDetails[m[1]] },
  { key: "buildLogs", re: /^\/v2\/releases\/([^/]+)\/build-logs$/, body: (s, m, q) => pageBuildLogs(s.buildLogs[m[1]], q.get("since")) },
  { key: "me", re: /^\/v1\/me$/, body: (s) => s.me },
  { key: "databases", re: /^\/v1\/databases$/, body: (s) => s.databases },
  { key: "dbMetricsSummary", re: /^\/v1\/databases\/[^/]+\/metrics\/summary$/, body: (s) => s.dbMetricsSummary },
  { key: "dbEvents", re: /^\/v1\/databases\/[^/]+\/events$/, body: (s) => s.dbEvents },
  { key: "databaseDetail", re: /^\/v1\/databases\/([^/]+)$/, body: (s, m) => s.databaseDetails[m[1]] },
];

export interface FakeBackend {
  client: LiaraClient;
  calls: string[];
}

/** Liara client whose fetch answers from the scenario; missing data = 404, `fail[key]` = that status. */
export function fakeLiara(s: Scenario, overrides: Record<string, number> = {}): FakeBackend {
  const calls: string[] = [];
  const fail = { ...s.fail, ...overrides };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.searchParams.get("teamID") === null) throw new Error("teamID missing");
    const path = decodeURIComponent(url.pathname);
    calls.push(path);
    for (const r of ROUTES) {
      const m = path.match(r.re);
      if (!m) continue;
      if (fail[r.key]) return new Response(JSON.stringify({ message: "synthetic failure" }), { status: fail[r.key] });
      const body = r.body(s, m, url.searchParams);
      if (body === undefined) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { client: createLiaraClient({ token: TEST_TOKEN, fetchImpl, retries: 0, timeoutMs: 2000 }), calls };
}

export const fakeProbe = (s: Scenario) => async (): Promise<ProbeResult> => s.probe;
export const nowOf = (s: Scenario) => () => Date.parse(s.now);

/* ------------------------------------------------------------ ctx builder */

export const T0 = Date.parse("2026-01-03T10:30:00.000Z");
type L = string | [string, string] | { ts?: string; message: string; stream?: string };

const toLine = (l: L) =>
  toEvidenceLine(typeof l === "string" ? { message: l } : Array.isArray(l) ? { ts: l[0], message: l[1] } : l, (s) => s);

/** Builds an ExtractContext from plain strings (or [isoTs, message] pairs). */
export function ctxOf(p: Partial<Omit<ExtractContext, "logs" | "events" | "buildLines">> & { logs?: L[]; events?: L[]; build?: L[] } = {}): ExtractContext {
  const logs = (p.logs ?? []).map(toLine);
  const events = (p.events ?? []).map(toLine);
  const buildLines = (p.build ?? []).map(toLine);
  return {
    mode: p.mode ?? "app",
    now: p.now ?? T0,
    windowMin: p.windowMin ?? 15,
    ...(p.app ? { app: p.app } : {}),
    ...(p.plan ? { plan: p.plan } : {}),
    logs,
    logGroups: groupLines(logs),
    buildLines,
    buildGroups: groupLines(buildLines),
    events,
    eventGroups: groupLines(events),
    applets: p.applets ?? [],
    releases: p.releases ?? [],
    ...(p.currentReleaseId ? { currentReleaseId: p.currentReleaseId } : {}),
    ...(p.metrics ? { metrics: p.metrics } : {}),
    ...(p.probe ? { probe: p.probe } : {}),
    dbs: p.dbs ?? [],
    ...(p.dbApps ? { dbApps: p.dbApps } : {}),
  };
}

export const iso = (min: number, sec = 0) => new Date(Date.parse("2026-01-03T10:00:00.000Z") + min * 60_000 + sec * 1000).toISOString();
