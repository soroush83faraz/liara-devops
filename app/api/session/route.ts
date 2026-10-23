import { z } from "zod";
import { fa } from "@/lib/i18n/fa";
import { getSession, isSameOrigin, sessionPublicView } from "@/lib/session";
import { liaraBaseUrl } from "@/lib/server/liara-base";
import { readJsonCapped } from "@/lib/server/body";
import { deriveIdentity } from "./identity";
import { GLOBAL_SESSION_ATTEMPTS_PER_MINUTE, SESSION_ATTEMPTS_PER_MINUTE, SESSION_BODY_MAX_BYTES, clientIp, createRateLimiter } from "./rate-limit";

const TIMEOUT_MS = 8000;
const NO_STORE = { "Cache-Control": "no-store" } as const;

// Per client address (see clientIp for which X-Forwarded-For hop is trusted) ...
const limiter = createRateLimiter(SESSION_ATTEMPTS_PER_MINUTE, 60_000);
// ... and a coarse circuit breaker over ALL clients that bounds distributed attempts (many addresses) per process.
const globalLimiter = createRateLimiter(GLOBAL_SESSION_ATTEMPTS_PER_MINUTE, 60_000, 1);

const bodySchema = z.object({
  token: z
    .string({ error: "tokenRequired" })
    .trim()
    .min(1, "tokenRequired")
    .min(8, "tokenInvalidFormat")
    .max(4096, "tokenInvalidFormat")
    .regex(/^\S+$/, "tokenInvalidFormat"),
  teamId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string({ error: "teamInvalidFormat" })
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "teamInvalidFormat")
      .optional(),
  ),
});

const validationMessages: Record<string, string> = {
  tokenRequired: fa.connect.errors.tokenRequired,
  tokenInvalidFormat: fa.connect.errors.tokenInvalidFormat,
  teamInvalidFormat: fa.connect.errors.teamInvalidFormat,
};

function fail(status: number, code: string, message: string, extra?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers: { ...NO_STORE, ...extra } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "forbidden_origin", fa.errors.forbiddenOrigin);

  const limit = limiter.hit(clientIp(request.headers));
  if (!limit.allowed) {
    return fail(429, "rate_limited", fa.errors.rateLimited, { "Retry-After": String(limit.retryAfter) });
  }
  const global = globalLimiter.hit("all");
  if (!global.allowed) {
    return fail(429, "rate_limited", fa.errors.rateLimited, { "Retry-After": String(global.retryAfter) });
  }

  // Bounded read: Content-Length is a fast 413, the streaming cap enforces it even for chunked bodies.
  const body = await readJsonCapped(request, SESSION_BODY_MAX_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? fail(413, "payload_too_large", fa.errors.badRequest)
      : fail(400, "bad_request", fa.errors.badRequest);
  }
  if (body.empty) return fail(400, "bad_request", fa.errors.badRequest);
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) {
    const message = validationMessages[parsed.error.issues[0]?.message ?? ""] ?? fa.errors.badRequest;
    return fail(400, "validation", message);
  }
  const { token, teamId } = parsed.data;

  const url = new URL("/v1/me", liaraBaseUrl());
  if (teamId) url.searchParams.set("teamID", teamId);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
    return fail(504, timedOut ? "liara_timeout" : "liara_unreachable", timedOut ? fa.errors.liaraTimeout : fa.errors.liaraUnavailable);
  }

  if (upstream.status === 401) return fail(401, "invalid_token", fa.errors.unauthorized);
  if (upstream.status === 403) return fail(403, "team_forbidden", fa.errors.teamForbidden);
  if (upstream.status === 429) return fail(429, "liara_rate_limited", fa.errors.rateLimited, { "Retry-After": "30" });
  if (!upstream.ok) return fail(502, "liara_error", fa.errors.liaraUnavailable);

  let me: unknown;
  try {
    me = await upstream.json();
  } catch {
    return fail(502, "liara_bad_response", fa.errors.liaraBadResponse);
  }
  const identity = deriveIdentity(me, teamId);
  if (!identity) return fail(502, "liara_bad_response", fa.errors.liaraBadResponse);

  const session = await getSession();
  session.token = token;
  session.teamId = teamId;
  session.accountId = identity.accountId;
  session.userName = identity.userName;
  session.teamName = identity.teamName;
  session.teamMemberRole = identity.teamMemberRole;
  await session.save();

  return Response.json(sessionPublicView(session), { headers: NO_STORE });
}

export async function GET() {
  const session = await getSession();
  const view = sessionPublicView(session.token ? session : null);
  if (!view) return fail(401, "unauthorized", fa.errors.unauthorizedReconnect);
  return Response.json(view, { headers: NO_STORE });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "forbidden_origin", fa.errors.forbiddenOrigin);
  const session = await getSession();
  session.destroy();
  return Response.json({ ok: true }, { headers: NO_STORE });
}
