import { fa } from "@/lib/i18n/fa";
import { globalCache } from "@/lib/canvas/ttl-cache";
import { collectErrors, parseNetworkParam } from "@/lib/observability/aggregate";
import { cachedOverview } from "@/lib/observability/overview";
import { OBSERVABILITY_TTL_MS, type ObsErrorsDto } from "@/lib/observability/types";
import { api, errorResponse } from "@/lib/server/liara";
import { parseMetricRange } from "@/lib/service/app-read/metrics-range";
import { json } from "@/lib/service/app-read/route-helpers";

/**
 * GET /api/observability/errors?range=&network=: the last ERROR / STDERR runtime-log lines of each app in the same
 * (capped) service set as GET /api/observability. Lines are masked server-side (pattern rules + the app's own env
 * values) before they leave the server. Cached 15 s per account/team/range/network.
 */
export const GET = api(async ({ liara, session, request }) => {
  const sp = new URL(request.url).searchParams;
  const range = parseMetricRange(sp.get("range"));
  if (!range) return errorResponse(400, "bad_range", fa.errors.badRequest);
  const network = parseNetworkParam(sp.get("network"));
  if (network === "invalid") return errorResponse(400, "bad_network", fa.errors.badRequest);
  const key = `${session.accountId}:${session.teamId ?? ""}:${range}:${network ?? ""}`;
  const body = await globalCache<ObsErrorsDto>("observability-errors", OBSERVABILITY_TTL_MS).get(key, async () => {
    const overview = await cachedOverview(liara, session);
    return collectErrors({ liara, overview, range, network, scope: { accountId: session.accountId, teamId: session.teamId } });
  });
  return json(body);
});
