import {
  getDatabaseMetricSeries,
  getDatabaseMetricsSummary,
  getMe,
  isLiaraError,
  listDbPlans,
  type MetricName,
} from "@/lib/liara";
import { fa } from "@/lib/i18n/fa";
import { api, errorResponse } from "@/lib/server/liara";
import { assembleMetrics } from "@/lib/service/app-read/metrics";
import { parseMetricRange, rangeToSince } from "@/lib/service/app-read/metrics-range";
import { part, toUsage } from "@/lib/service/app-read/overview";
import { dbFrom, json, type HostCtx } from "@/lib/service/db/route-helpers";

/**
 * `?range=15m|1h|6h|24h` -> normalised series + current summary (incl. disk usage). Same contract as the app metrics
 * route: units and `since` are unverified [VAL]; unparsable/empty answers become `{unavailable:true,reason}` (HTTP 200).
 */
export const GET = api(async (ctx, { params }: HostCtx) => {
  const r = await dbFrom(ctx, params);
  if ("error" in r) return r.error;
  const { db } = r;
  const range = parseMetricRange(new URL(ctx.request.url).searchParams.get("range"));
  if (!range) return errorResponse(400, "bad_range", fa.errors.badRequest);
  const since = rangeToSince(range);
  const series = (m: MetricName) => getDatabaseMetricSeries(ctx.liara, db.ref, m, since);
  const [cpu, memory, networkRx, networkTx, summary, me] = await Promise.allSettled([
    series("cpu"),
    series("memory"),
    series("network-receive"),
    series("network-transmit"),
    getDatabaseMetricsSummary(ctx.liara, db.ref),
    getMe(ctx.liara),
  ]);

  // Auth/permission problems must surface as such, not as "unavailable".
  for (const s of [cpu, memory, networkRx, networkTx, summary]) {
    if (s.status === "rejected" && isLiaraError(s.reason) && ["auth", "forbidden", "not_found"].includes(s.reason.kind)) throw s.reason;
  }

  let limits;
  if (me.status === "fulfilled" && db.summary.planID) {
    const plan = listDbPlans(me.value, { availableOnly: false, region: "any", includeLegacy: true }).find((p) => p.id === db.summary.planID);
    if (plan && (plan.ramGb !== undefined || plan.cpu !== undefined)) limits = { ramGb: plan.ramGb, cpu: plan.cpu };
  }

  return json(
    assembleMetrics({
      range,
      since,
      cpu: part(cpu),
      memory: part(memory),
      networkRx: part(networkRx),
      networkTx: part(networkTx),
      current: summary.status === "fulfilled" ? toUsage(summary.value) : undefined,
      limits,
    }),
  );
});
