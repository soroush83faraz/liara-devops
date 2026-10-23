// Server-only. Aggregates per-service metrics, deployment markers and recent error lines for the monitoring
// dashboard from the SAME Liara calls the per-service tabs use. Nothing is invented: a failing call makes that
// service (or that part) `{unavailable:true}`; only an auth failure fails the whole response.
import {
  getAppMetricSeries,
  getAppMetricsSummary,
  getDatabaseMetricSeries,
  getDatabaseMetricsSummary,
  getMe,
  getRuntimeLogs,
  isLiaraError,
  listAppPlans,
  listDbPlans,
  listReleases,
  type LiaraClient,
  type MetricName,
  type Me,
} from "@/lib/liara";
import type { Overview, OverviewService } from "@/lib/canvas/types";
import { logRedactorFor, type RedactorScope } from "@/lib/service/app-read/known-secrets";
import { assembleMetrics } from "@/lib/service/app-read/metrics";
import { rangeToSince } from "@/lib/service/app-read/metrics-range";
import { toLogLineDtos } from "@/lib/service/app-read/mappers";
import { part, toUsage, type Part } from "@/lib/service/app-read/overview";
import type { MetricRange, MetricsDto, MetricsUnavailableDto } from "@/lib/service/app-read/types";
import {
  MAX_ERROR_LINES_PER_APP,
  MAX_OBSERVED_SERVICES,
  MAX_RELEASES_PER_APP,
  SERVICE_CONCURRENCY,
  type ObsErrorsDto,
  type ObsErrorsEntry,
  type ObsRelease,
  type ObsServiceDto,
  type ObservabilityDto,
} from "./types";

const NETWORK_RE = /^[\w.:@-]{1,64}$/;

/** `?network=` -> id, null (no filter) or "invalid". */
export function parseNetworkParam(v: string | null): string | null | "invalid" {
  if (v === null || v === "") return null;
  return NETWORK_RE.test(v) ? v : "invalid";
}

const ATTENTION = new Set(["failed", "unhealthy"]);

/**
 * Services matching the network filter, problems first, apps before databases, then by name; capped to
 * MAX_OBSERVED_SERVICES. `total` is the number matching the filter (before the cap).
 */
export function selectServices(overview: Pick<Overview, "services">, network: string | null, max = MAX_OBSERVED_SERVICES) {
  const matching = overview.services.filter((s) => network === null || s.networkId === network);
  const rank = (s: OverviewService) => (ATTENTION.has(s.status) ? 0 : 1);
  const sorted = [...matching].sort(
    (a, b) => rank(a) - rank(b) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
  return { selected: sorted.slice(0, max), total: matching.length };
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

/** Auth problems mean the whole session is bad: surface them instead of calling every service "unavailable". */
function rethrowAuth(...results: Array<PromiseSettledResult<unknown>>): void {
  for (const r of results) if (r.status === "rejected" && isLiaraError(r.reason) && r.reason.kind === "auth") throw r.reason;
}

function planLimits(me: Me | undefined, s: OverviewService): MetricsDto["limits"] {
  if (!me || !s.planId) return undefined;
  const plans = s.kind === "app" ? listAppPlans(me, { availableOnly: false, region: "any", includeLegacy: true }) : listDbPlans(me, { availableOnly: false, region: "any", includeLegacy: true });
  const plan = plans.find((p) => p.id === s.planId);
  return plan && (plan.ramGb !== undefined || plan.cpu !== undefined) ? { ramGb: plan.ramGb, cpu: plan.cpu } : undefined;
}

async function metricsFor(
  liara: LiaraClient,
  s: OverviewService,
  range: MetricRange,
  since: number,
  me: Me | undefined,
): Promise<MetricsDto | MetricsUnavailableDto> {
  const ref = s.kind === "app" ? s.name : s.ref;
  if (!ref) return { unavailable: true, reason: "request_failed", range };
  const series = (m: MetricName) => (s.kind === "app" ? getAppMetricSeries(liara, ref, m, since) : getDatabaseMetricSeries(liara, ref, m, since));
  const summary = () => (s.kind === "app" ? getAppMetricsSummary(liara, ref) : getDatabaseMetricsSummary(liara, ref));
  const [cpu, memory, networkRx, networkTx, usage] = await Promise.allSettled([
    series("cpu"),
    series("memory"),
    series("network-receive"),
    series("network-transmit"),
    summary(),
  ]);
  rethrowAuth(cpu, memory, networkRx, networkTx, usage);
  const current: Part<ReturnType<typeof toUsage>> = usage.status === "fulfilled" ? { ok: true, value: toUsage(usage.value) } : { ok: false };
  return assembleMetrics({
    range,
    since,
    cpu: part(cpu),
    memory: part(memory),
    networkRx: part(networkRx),
    networkTx: part(networkTx),
    current: current.ok ? current.value : undefined,
    limits: planLimits(me, s),
  });
}

async function releasesFor(liara: LiaraClient, name: string): Promise<{ releases: ObsRelease[]; unavailable?: true }> {
  try {
    const page = await listReleases(liara, name, { page: 1, count: MAX_RELEASES_PER_APP });
    const releases = page.releases
      .filter((r): r is typeof r & { _id: string; createdAt: string } => Boolean(r._id && r.createdAt))
      .map((r): ObsRelease => ({ id: r._id, at: r.createdAt, state: r.state ?? "UNKNOWN", ...(r.tag ? { tag: r.tag } : {}) }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, MAX_RELEASES_PER_APP);
    return { releases };
  } catch (e) {
    if (isLiaraError(e) && e.kind === "auth") throw e;
    return { releases: [], unavailable: true };
  }
}

export interface CollectInput {
  liara: LiaraClient;
  overview: Pick<Overview, "services" | "networks">;
  range: MetricRange;
  /** Network (project) id filter; null = all. */
  network: string | null;
  now?: number;
}

export async function collectObservability({ liara, overview, range, network, now = Date.now() }: CollectInput): Promise<ObservabilityDto> {
  const since = rangeToSince(range, now);
  const { selected, total } = selectServices(overview, network);
  // Plans are only needed for the "limit" meters; without them the numbers are still shown, just without a limit.
  let me: Me | undefined;
  if (selected.length > 0) {
    const r = await Promise.allSettled([getMe(liara)]);
    rethrowAuth(r[0]);
    me = r[0].status === "fulfilled" ? r[0].value : undefined;
  }
  const services = await mapPool(selected, SERVICE_CONCURRENCY, async (s): Promise<ObsServiceDto> => {
    const [metrics, rel] = await Promise.all([
      metricsFor(liara, s, range, since, me),
      s.kind === "app" ? releasesFor(liara, s.name) : Promise.resolve({ releases: [] as ObsRelease[] }),
    ]);
    const unavailableReleases = "unavailable" in rel && rel.unavailable;
    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      platformOrEngine: s.platformOrEngine,
      status: s.status,
      networkId: s.networkId,
      ...(s.planId ? { planId: s.planId } : {}),
      ...(rel.releases[0] ? { lastReleaseAt: rel.releases[0].at } : {}),
      releases: rel.releases,
      ...(unavailableReleases ? { releasesUnavailable: true as const } : {}),
      metrics,
    };
  });
  return {
    range,
    since,
    generatedAt: new Date(now).toISOString(),
    unitsVerified: false,
    networks: [...overview.networks],
    services,
    truncated: { shown: services.length, total },
  };
}

/** Lines scanned per app (newest kept); the panel shows the last few that look like errors. */
const SCAN_LINES = 1000;
const MESSAGE_MAX = 600;

export async function collectErrors({
  liara,
  scope,
  overview,
  range,
  network,
  now = Date.now(),
}: CollectInput & { scope: RedactorScope }): Promise<ObsErrorsDto> {
  const startSec = rangeToSince(range, now);
  const { selected, total } = selectServices(overview, network);
  const apps = selected.filter((s) => s.kind === "app");
  const entries = await mapPool(apps, SERVICE_CONCURRENCY, async (s): Promise<ObsErrorsEntry> => {
    try {
      const [{ lines }, redactor] = await Promise.all([getRuntimeLogs(liara, s.name, { startSec }), logRedactorFor(liara, scope, s.name)]);
      // Masked as one batch (secrets split over two lines are caught), THEN filtered.
      const dtos = toLogLineDtos(lines.slice(-SCAN_LINES), redactor);
      const hits = dtos.filter((l) => l.level === "error" || (l.stream === "stderr" && l.level === "unknown"));
      return {
        id: s.id,
        name: s.name,
        unavailable: false,
        count: hits.length,
        lines: hits.slice(-MAX_ERROR_LINES_PER_APP).map((l) => ({
          ts: l.ts,
          stream: l.stream,
          level: l.level,
          message: l.message.length > MESSAGE_MAX ? `${l.message.slice(0, MESSAGE_MAX)}…` : l.message,
        })),
      };
    } catch (e) {
      if (isLiaraError(e) && e.kind === "auth") throw e;
      return { id: s.id, name: s.name, unavailable: true };
    }
  });
  return { range, generatedAt: new Date(now).toISOString(), entries, truncated: { shown: selected.length, total } };
}
