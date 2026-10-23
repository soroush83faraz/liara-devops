import {
  getAppMetricSeries,
  getAppMetricsSummary,
  getMe,
  isLiaraError,
  getApp,
  listAppPlans,
  type MetricName,
} from "@/lib/liara";
import { fa } from "@/lib/i18n/fa";
import { api, errorResponse } from "@/lib/server/liara";
import { assembleMetrics } from "@/lib/service/app-read/metrics";
import { parseMetricRange, rangeToSince } from "@/lib/service/app-read/metrics-range";
import { part, toUsage } from "@/lib/service/app-read/overview";
import { appNameFrom, json } from "@/lib/service/app-read/route-helpers";

type Ctx = { params: Promise<{ name: string }> };

/**
 * `?range=15m|1h|6h|24h` -> normalised series (cpu, memory, network rx/tx) + current summary.
 * Units and the `since` window are unverified [VAL]; unparsable/empty answers become `{unavailable:true,reason}`
 * with HTTP 200 so the tab can render an honest empty state.
 */
export const GET = api(async ({ liara, request }, { params }: Ctx) => {
  const r = await appNameFrom(params);
  if ("error" in r) return r.error;
  const range = parseMetricRange(new URL(request.url).searchParams.get("range"));
  if (!range) return errorResponse(400, "bad_range", fa.errors.badRequest);
  const since = rangeToSince(range);
  const series = (m: MetricName) => getAppMetricSeries(liara, r.name, m, since);
  const [cpu, memory, networkRx, networkTx, summary, app, me] = await Promise.allSettled([
    series("cpu"),
    series("memory"),
    series("network-receive"),
    series("network-transmit"),
    getAppMetricsSummary(liara, r.name),
    getApp(liara, r.name),
    getMe(liara),
  ]);

  // Auth/permission problems must surface as such, not as "unavailable".
  for (const s of [cpu, memory, networkRx, networkTx, summary, app]) {
    if (s.status === "rejected" && isLiaraError(s.reason) && ["auth", "forbidden", "not_found"].includes(s.reason.kind)) throw s.reason;
  }

  let limits;
  if (app.status === "fulfilled" && me.status === "fulfilled" && app.value.planID) {
    const plan = listAppPlans(me.value, { availableOnly: false, region: "any", includeLegacy: true }).find((p) => p.id === app.value.planID);
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
