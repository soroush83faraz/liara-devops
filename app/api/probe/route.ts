import { createRateLimiter, type RateLimiter } from "@/lib/canvas/rate-limit";
import { probeApp } from "@/lib/canvas/probe";
import { parseProbeBody } from "@/lib/canvas/probe-request";
import { globalCache } from "@/lib/canvas/ttl-cache";
import { fa } from "@/lib/i18n/fa";
import { readJsonCapped } from "@/lib/server/body";
import { api, errorResponse } from "@/lib/server/liara";

const PROBES_PER_MINUTE = 60;
const TARGET_TTL_MS = 5 * 60_000;
const MAX_BODY_BYTES = 2_048;

function limiter(): RateLimiter {
  const g = globalThis as unknown as Record<symbol, RateLimiter | undefined>;
  const sym = Symbol.for("hamyar.canvas.probeLimiter");
  return (g[sym] ??= createRateLimiter(PROBES_PER_MINUTE, 60_000));
}

/**
 * POST /api/probe {service}: one HTTP GET against the app's OWN public address, resolved server-side from Liara.
 * The client never supplies a URL. Probe failures are a 200 with `ok:false` (they are the answer, not an API error).
 */
export const POST = api(async ({ liara, session, request }) => {
  // Bounded read: an oversize body (declared or streamed) is a 413 before it is buffered.
  const body = await readJsonCapped(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? errorResponse(413, "payload_too_large", fa.errors.badRequest)
      : errorResponse(400, "bad_request", fa.errors.badRequest);
  }
  const parsed = parseProbeBody(body.value);
  if (!parsed) return errorResponse(400, "bad_request", fa.errors.badRequest);

  const account = `${session.accountId}:${session.teamId ?? ""}`;
  const gate = limiter().check(account);
  if (!gate.allowed) return errorResponse(429, "rate_limited", fa.errors.rateLimited, { retryAfterSec: gate.retryAfterSec });

  const result = await probeApp(liara, parsed.name, {
    targetCache: globalCache<string | null>("probeTarget", TARGET_TTL_MS),
    cacheKey: `${account}:${parsed.name}`,
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});
