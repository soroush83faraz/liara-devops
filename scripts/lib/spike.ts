import { z } from "zod";
import { BillingSchema, isLiaraError, listAppPlans, listDbPlans, listDbVersions, MeSchema, MetricSeriesSchema, normalizeAccount, normalizeBilling, normalizeSeries, parseRuntimeLogs, type LiaraClient } from "../../lib/liara";
import { probeAi, type AiConfig, type AiProbeResult } from "./spike-ai";
import { distinctValues, shapeOf, type Shape } from "./spike-shape";

export type Outcome = "pass" | "warn" | "fail" | "skip" | "inconclusive";
export interface CheckResult {
  item: number;
  name: string;
  outcome: Outcome;
  detail: string;
  /** What changes in the product if this check does not pass. */
  changes?: string;
}
export interface EndpointRecord {
  path: string;
  ok: boolean;
  status?: number;
  kind?: string;
  code?: string;
  shape?: Shape;
}
export interface SpikeReport {
  _note: string;
  generatedAt: string;
  options: { ai: boolean; rateProbe: number; appSpecified: boolean };
  checks: CheckResult[];
  endpoints: Record<string, EndpointRecord>;
  enums: Record<string, string[]>;
  counts: Record<string, number>;
  ai?: Array<Pick<AiProbeResult, "name" | "ok" | "status" | "detail" | "shape">>;
}
export interface SpikeOptions {
  client: LiaraClient;
  app?: string;
  ai?: AiConfig;
  rateProbe?: number;
  /** Raw GET used only by the rate-limit probe (needs response headers); the closure owns the token. */
  rawGet?: (path: string) => Promise<Response>;
  fetchImpl?: typeof fetch;
  now?: Date;
}

/** Shown per non-passing item: what the product loses / which fallback applies. */
export const CHANGES: Record<number, string> = {
  1: "v2 failing falls back to v1 automatically; if both fail the evidence engine marks logs unavailable (partial-failure path) and the copilot loses log evidence.",
  2: "release detail/build-logs are CLI endpoints: without them the releases tab shows no build output and build-failure diagnosis degrades to state + failReason only.",
  3: "metrics charts need the right `since` unit: adjust lib/liara/metrics.ts and the evidence collectors; until then the metrics tab shows 'unavailable' and OOM/CPU findings lose their numbers.",
  4: "(mutating, tests/live) if update-envs is not a full replace the safe-merge helper must change; the variables tab stays disabled until verified.",
  5: "AI base URL, tool calling or json_schema failing means: switch LIARA_AI_BASE_URL form, use the single structured-call fallback (no tools) or choose another model via LLM_MODEL.",
  6: "plan/price shapes drive cost lines in every create/resize dialog: fix lib/liara/account.ts normalisers before enabling billed flows.",
  7: "database list/detail shapes drive the DB panel and env->DB edges: fix lib/liara/databases.ts before enabling DB features.",
  8: "networks are the project grouping: if `network` is absent on apps the canvas falls back to the single 'no network' group.",
  9: "domain doctor needs CNameRecord/verificationCode from the check call; without them DNS guidance becomes generic text.",
  10: "(mutating, tests/live) redeploy-previous stays hidden unless an older release can be redeployed by image or sourceID.",
  11: "unknown status enums are shown as raw strings with a neutral badge; record the real values in lib/liara/schemas.ts docs and the status maps.",
  12: "without known rate-limit behaviour keep the concurrency cap at 3 and the 429 backoff on reads only.",
  13: "(mutating, tests/live) create flow cannot show an accurate initial state until scale/isDeployed after create is known.",
};

type Attempt = { ok: true; raw: unknown } | { ok: false; kind: string; status: number; code?: string };

export async function runSpike(opts: SpikeOptions): Promise<SpikeReport> {
  const { client } = opts;
  const now = opts.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const endpoints: Record<string, EndpointRecord> = {};
  const checks: CheckResult[] = [];
  const enums: Record<string, string[]> = {};
  const counts: Record<string, number> = {};

  /** One read-only GET, recorded as a shape. Never throws. */
  async function get(name: string, template: string, path: string, query?: Record<string, string | number | boolean>): Promise<Attempt> {
    try {
      const raw = await client.get(path, z.unknown(), { query, timeoutMs: 30_000 });
      endpoints[name] = { path: template, ok: true, shape: shapeOf(raw) };
      return { ok: true, raw };
    } catch (e) {
      const a = isLiaraError(e) ? { kind: e.kind, status: e.status, code: e.code } : { kind: "other", status: 0, code: undefined };
      endpoints[name] = { path: template, ok: false, status: a.status, kind: a.kind, ...(a.code ? { code: a.code } : {}) };
      return { ok: false, ...a };
    }
  }
  const field = (raw: unknown, key: string): unknown[] => {
    const v = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
    return Array.isArray(v) ? v : [];
  };
  const id = (v: unknown, key: string): string | undefined => {
    const x = v !== null && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
    return typeof x === "string" && x ? x : undefined;
  };
  const add = (item: number, name: string, outcome: Outcome, detail: string) => checks.push({ item, name, outcome, detail, ...(outcome === "pass" ? {} : { changes: CHANGES[item] }) });
  const seg = encodeURIComponent;

  // ---- account ---------------------------------------------------------------
  const me = await get("me", "/v1/me", "/v1/me");
  const billing = await get("billing", "/v1/billing", "/v1/billing");
  const teamId = client.teamId || undefined;
  if (me.ok) {
    const parsed = MeSchema.safeParse(me.raw);
    if (parsed.success) {
      const appPlans = listAppPlans(parsed.data);
      const dbPlans = listDbPlans(parsed.data);
      counts.appPlans = appPlans.length;
      counts.dbPlans = dbPlans.length;
      counts.dbEngines = listDbVersions(parsed.data).length;
      const finite = [...appPlans, ...dbPlans].every((p) => Number.isFinite(p.pricePerMonth));
      // Team mode (verified live 2026-10-23): /v1/me and /v1/billing carry `user` AND `team`; the balance that matters is team.balance.
      const acct = normalizeAccount(parsed.data, teamId);
      const bill = billing.ok ? BillingSchema.safeParse(billing.raw) : undefined;
      const nb = bill?.success ? normalizeBilling(bill.data, teamId) : undefined;
      const teamOk = !teamId || (!acct.teamUnreadable && nb !== undefined && !nb.teamUnreadable);
      const account = `account source ${acct.source}, balance ${nb ? (nb.balance === undefined ? "unknown" : "known") : "unreadable"}${teamId && !teamOk ? ", team object/balance MISSING" : ""}`;
      add(6, "GET /v1/me plan shapes", appPlans.length + dbPlans.length > 0 && finite ? (teamOk ? "pass" : "warn") : "fail", `app plans ${appPlans.length}, db plans ${dbPlans.length}, engines ${counts.dbEngines}, prices finite ${finite}, ${account}`);
    } else add(6, "GET /v1/me plan shapes", "fail", "response did not match the lenient schema");
  } else add(6, "GET /v1/me plan shapes", "fail", `request failed (${me.kind} ${me.status})`);

  // ---- apps --------------------------------------------------------------------
  const projects = await get("projects", "/v1/projects", "/v1/projects");
  const appList = projects.ok ? field(projects.raw, "projects") : [];
  counts.apps = appList.length;
  const app = opts.app ?? id(appList[0], "project_id");
  enums.appStatus = distinctValues(appList, "status");
  enums.appScale = distinctValues(appList, "scale");
  enums.appPlatform = distinctValues(appList, "type");
  counts.appsWithNetwork = appList.filter((a) => (a as { network?: unknown } | null)?.network).length;

  let appDetail: Attempt | undefined;
  let releases: unknown[] = [];
  if (app) {
    const p = `/v1/projects/${seg(app)}`;
    appDetail = await get("appDetail", "/v1/projects/{name}", p);
    const applets = await get("applets", "/v1/projects/{name}/applets", `${p}/applets`);
    const rel = await get("releases", "/v1/projects/{name}/releases", `${p}/releases`, { page: 1, count: 20 });
    releases = rel.ok ? field(rel.raw, "releases") : [];
    if (applets.ok) {
      enums.appletState = distinctValues(field(applets.raw, "applets"), "state");
      enums.appletReason = distinctValues(field(applets.raw, "applets"), "reason");
    }
    enums.releaseState = distinctValues(releases, "state");
    counts.releases = releases.length;
    counts.releasesWithImageName = releases.filter((r) => id(r, "imageName")).length;
    counts.releasesWithSourceAvailable = releases.filter((r) => (r as { sourceAvailable?: unknown } | null)?.sourceAvailable === true).length;
  }

  // 2. release detail + build logs
  const relId = id(releases[0], "_id");
  if (relId) {
    const detail = await get("releaseDetail", "/v1/releases/{id}", `/v1/releases/${seg(relId)}`);
    const build = await get("buildLogs", "/v2/releases/{id}/build-logs", `/v2/releases/${seg(relId)}/build-logs`);
    add(2, "release detail + build-logs accept the API key", detail.ok && build.ok ? "pass" : "fail", `release detail ${detail.ok ? "ok" : `${detail.kind} ${detail.status}`}; build-logs ${build.ok ? "ok" : `${build.kind} ${build.status}`}`);
  } else add(2, "release detail + build-logs accept the API key", "inconclusive", app ? "app has no releases" : "no app to read from");

  // 1. runtime logs v2 and v1
  if (app) {
    const start = nowSec - 3600;
    const v2 = await get("runtimeLogsV2", "/v2/projects/{name}/logs", `/v2/projects/${seg(app)}/logs`, { start, direction: "forward", last_lines: false });
    const v1 = await get("runtimeLogsV1", "/v1/projects/{name}/logs", `/v1/projects/${seg(app)}/logs`, { since: start });
    const n2 = v2.ok ? parseRuntimeLogs(v2.raw).length : -1;
    const n1 = v1.ok ? parseRuntimeLogs(v1.raw).length : -1;
    counts.logLinesV2 = Math.max(n2, 0);
    counts.logLinesV1 = Math.max(n1, 0);
    const outcome: Outcome = v2.ok ? (n2 > 0 ? "pass" : "inconclusive") : v1.ok ? "warn" : "fail";
    add(1, "runtime logs v2 shape, v1 fallback", outcome, `v2 ${v2.ok ? `ok, ${n2} lines parsed` : `${v2.kind} ${v2.status}`}; v1 ${v1.ok ? `ok, ${n1} lines parsed` : `${v1.kind} ${v1.status}`}`);
  } else add(1, "runtime logs v2 shape, v1 fallback", "inconclusive", "no app to read from");

  // events (feeds item 11 stream values)
  if (app) {
    const ev = await get("events", "/v1/projects/{name}/events", `/v1/projects/${seg(app)}/events`, { start: nowSec - 86400, end: nowSec });
    if (ev.ok) counts.eventLines = parseRuntimeLogs(ev.raw).length;
  }

  // 3. metrics
  if (app) {
    const p = `/v1/projects/${seg(app)}/metrics`;
    const summary = await get("metricsSummary", "/v1/projects/{name}/metrics/summary", `${p}/summary`);
    const candidates: Array<[string, number]> = [["unix_seconds_1h_ago", nowSec - 3600], ["relative_seconds_3600", 3600], ["unix_ms_1h_ago", (nowSec - 3600) * 1000]];
    const worked: string[] = [];
    const tried: string[] = [];
    for (const [label, since] of candidates) {
      const r = await get(`metricsCpu_${label}`, `/v1/projects/{name}/metrics/cpu?since=<${label}>`, `${p}/cpu`, { since });
      tried.push(`${label}:${r.ok ? "ok" : r.status}`);
      const points = r.ok ? normalizeSeries(MetricSeriesSchema.parse(r.raw)).reduce((n, x) => n + x.points.length, 0) : 0;
      if (points > 0) worked.push(label);
    }
    add(3, "metrics: summary and `since` unit", summary.ok && worked.length > 0 ? "pass" : "fail", `summary ${summary.ok ? "ok" : `${summary.kind} ${summary.status}`}; since candidates ${tried.join(", ")}; with data: [${worked.join(",")}]`);
  } else add(3, "metrics: summary and `since` unit", "inconclusive", "no app to read from");

  // 9. domains
  if (app) {
    const list = await get("domains", "/v1/domains", "/v1/domains", { project: app });
    const domains = list.ok ? field(list.raw, "domains") : [];
    counts.domains = domains.length;
    enums.domainStatus = distinctValues(domains, "status");
    enums.domainCertificatesStatus = distinctValues(domains, "certificatesStatus");
    const domainId = id(domains[0], "_id");
    if (!list.ok) add(9, "domains list + check record values (read-only part)", "fail", `list ${list.kind} ${list.status}`);
    else if (!domainId) add(9, "domains list + check record values (read-only part)", "inconclusive", "no custom domain on the app; add/check record values need tests/live");
    else {
      const chk = await get("domainCheck", "/v1/domains/{id}/check", `/v1/domains/${seg(domainId)}/check`);
      const d = chk.ok ? (chk.raw as { domain?: unknown } | null)?.domain : undefined;
      const has = (k: string) => d !== null && typeof d === "object" && k in (d as object);
      add(9, "domains list + check record values (read-only part)", chk.ok ? "pass" : "fail", `check ${chk.ok ? "ok" : `${chk.kind} ${chk.status}`}; CNameRecord key ${has("CNameRecord")}, verificationCode key ${has("verificationCode")}`);
    }
  } else add(9, "domains list + check record values (read-only part)", "inconclusive", "no app to read from");

  // 7. databases
  const dbs = await get("databases", "/v1/databases", "/v1/databases");
  const dbList = dbs.ok ? field(dbs.raw, "databases") : [];
  counts.databases = dbList.length;
  enums.dbStatus = distinctValues(dbList, "status");
  enums.dbEngine = distinctValues(dbList, "type");
  const dbRef = id(dbList[0], "_id") ?? id(dbList[0], "id") ?? id(dbList[0], "DBId");
  if (!dbs.ok) add(7, "databases list and detail", "fail", `list ${dbs.kind} ${dbs.status}`);
  else if (!dbRef) add(7, "databases list and detail", "inconclusive", "no databases on the account");
  else {
    const d = await get("databaseDetail", "/v1/databases/{id}", `/v1/databases/${seg(dbRef)}`);
    const inner = d.ok ? (d.raw as { database?: unknown } | null)?.database : undefined;
    const hasPw = inner !== null && typeof inner === "object" && "root_password" in (inner as object);
    add(7, "databases list and detail", d.ok ? "pass" : "fail", `detail ${d.ok ? "ok" : `${d.kind} ${d.status}`}; root_password key present ${hasPw} (value never recorded)`);
  }

  // 8. networks
  const nets = await get("networks", "/v1/networks", "/v1/networks");
  counts.networks = nets.ok ? field(nets.raw, "networks").length : 0;
  add(8, "networks list and `network` on apps", nets.ok ? "pass" : "fail", `networks ${nets.ok ? counts.networks : `${nets.kind} ${nets.status}`}; apps with a network field ${counts.appsWithNetwork}/${counts.apps}`);

  // 11. enums
  const known = Object.entries(enums).filter(([, v]) => v.length > 0).map(([k, v]) => `${k}=[${v.join(",")}]`);
  add(11, "status enums seen", known.length > 0 ? "pass" : "inconclusive", known.length ? known.join("; ") : "no enum-like values found (empty account?)");

  // 12. rate limits (opt-in burst of GETs)
  const burst = opts.rateProbe ?? 0;
  if (burst > 0 && opts.rawGet) {
    const statuses: Record<string, number> = {};
    const headerNames = new Set<string>();
    for (let i = 0; i < burst; i++) {
      try {
        const res = await opts.rawGet("/v1/me");
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        res.headers.forEach((_v, k) => /rate|retry|limit/i.test(k) && headerNames.add(k));
        await res.arrayBuffer();
      } catch {
        statuses.network = (statuses.network ?? 0) + 1;
      }
    }
    counts.rateProbeRequests = burst;
    enums.rateProbeStatuses = Object.entries(statuses).map(([s, n]) => `${s}x${n}`);
    enums.rateHeaders = [...headerNames].sort();
    const bad = Object.keys(statuses).some((s) => s.startsWith("5") || s === "network");
    add(12, "rate-limit behaviour under a GET burst", bad ? "fail" : "pass", `statuses ${enums.rateProbeStatuses.join(" ")}; rate-like headers [${enums.rateHeaders.join(",")}]`);
  } else add(12, "rate-limit behaviour under a GET burst", "skip", "not requested (use --rate-probe <n>)");

  // mutating items live in tests/live behind ALLOW_BILLED_LIVE_TESTS
  add(4, "update-envs full-replace semantics", "skip", "mutating: run tests/live with ALLOW_BILLED_LIVE_TESTS=1");
  add(10, "redeploy an older release by sourceID/image", "skip", `mutating: tests/live. Hint from releases read: ${counts.releasesWithImageName ?? 0}/${counts.releases ?? 0} have imageName, ${counts.releasesWithSourceAvailable ?? 0} have sourceAvailable`);
  const detailInner = appDetail?.ok ? (appDetail.raw as { project?: unknown } | null)?.project : undefined;
  const seen = (k: string) => (detailInner !== null && typeof detailInner === "object" ? String((detailInner as Record<string, unknown>)[k]) : "n/a");
  add(13, "create-app initial scale/isDeployed", "skip", `mutating (billed): tests/live. Reference from an existing app: scale=${seen("scale")} isDeployed=${seen("isDeployed")}`);

  // 5. AI gateway
  let ai: SpikeReport["ai"];
  if (opts.ai) {
    const res = await probeAi(opts.ai, opts.fetchImpl);
    ai = res.map(({ name, ok, status, detail, shape }) => ({ name, ok, status, detail, ...(shape ? { shape } : {}) }));
    const failed = res.filter((r) => !r.ok);
    add(5, "AI gateway: base URL, streaming, tools, json_schema", failed.length === 0 ? "pass" : "fail", failed.length ? `failed: ${failed.map((r) => `${r.name} (${r.status})`).join(", ")}` : `${res.length} probes ok`);
  } else add(5, "AI gateway: base URL, streaming, tools, json_schema", "skip", "not requested (use --ai with LIARA_AI_BASE_URL, LIARA_AI_API_KEY, LLM_MODEL)");

  checks.sort((a, b) => a.item - b.item);
  return {
    _note: "REDACTED shape report recorded from a real Liara account by scripts/spike.ts: key names, JSON types, enum-like values, counts. No free text, tokens or env values.",
    generatedAt: now.toISOString(),
    options: { ai: Boolean(opts.ai), rateProbe: burst, appSpecified: Boolean(opts.app) },
    checks,
    endpoints,
    enums,
    counts,
    ...(ai ? { ai } : {}),
  };
}

const LABEL: Record<Outcome, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP", inconclusive: "????" };

/** Pass/fail table mapped to checklist items 1-13, with a "what this changes" line under every non-pass row. */
export function formatTable(checks: readonly CheckResult[]): string {
  const rows = checks.flatMap((c) => [
    `${String(c.item).padStart(2)}  ${LABEL[c.outcome]}  ${c.name}`,
    `        ${c.detail}`,
    ...(c.outcome !== "pass" && c.outcome !== "skip" && c.changes ? [`        -> what this changes: ${c.changes}`] : []),
  ]);
  return rows.join("\n");
}
