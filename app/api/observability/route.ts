import { fa } from "@/lib/i18n/fa";
import { globalCache } from "@/lib/canvas/ttl-cache";
import { collectObservability, parseNetworkParam } from "@/lib/observability/aggregate";
import { cachedOverview } from "@/lib/observability/overview";
import { OBSERVABILITY_TTL_MS, type ObservabilityDto } from "@/lib/observability/types";
import { api, errorResponse } from "@/lib/server/liara";
import { parseMetricRange } from "@/lib/service/app-read/metrics-range";
import { json } from "@/lib/service/app-read/route-helpers";

/**
 * GET /api/observability?range=15m|1h|6h|24h[&network=<id>]: normalised CPU / memory / network series, current value,
 * plan limit, status and release times for up to 12 services (read-only). Cached 15 s per account/team/range/network.
 * A service whose metrics fail becomes `{metrics:{unavailable:true}}`; `truncated:{shown,total}` is always present.
 * Units and `since` are unverified [VAL] (`unitsVerified:false`).
 */
export const GET = api(async ({ liara, session, request }) => {
  const sp = new URL(request.url).searchParams;
  const range = parseMetricRange(sp.get("range"));
  if (!range) return errorResponse(400, "bad_range", fa.errors.badRequest);
  const network = parseNetworkParam(sp.get("network"));
  if (network === "invalid") return errorResponse(400, "bad_network", fa.errors.badRequest);
  const key = `${session.accountId}:${session.teamId ?? ""}:${range}:${network ?? ""}`;
  const body = await globalCache<ObservabilityDto>("observability", OBSERVABILITY_TTL_MS).get(key, async () => {
    const overview = await cachedOverview(liara, session);
    return collectObservability({ liara, overview, range, network });
  });
  return json(body);
});
