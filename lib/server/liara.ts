// Server-only glue: a Liara client bound to the caller's session, and a route wrapper that every API route
// uses so auth, origin checks and error mapping behave identically everywhere.
import { unstable_rethrow } from "next/navigation";
import { createLiaraClient, isLiaraError, type LiaraClient } from "../liara";
import { fa } from "../i18n/fa";
import { liaraBaseUrl } from "./liara-base";
import { isSameOrigin, requireSession, UnauthorizedError, type ValidSession } from "../session";

export function liaraFor(session: ValidSession): LiaraClient {
  return createLiaraClient({ token: session.token, teamId: session.teamId, baseUrl: liaraBaseUrl() });
}

const JSON_HEADERS = { "Cache-Control": "no-store" };

export function errorResponse(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: JSON_HEADERS });
}

/** Maps any thrown error to a safe JSON response (never includes tokens, bodies or stack traces). */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) return error.toResponse();
  if (isLiaraError(error)) {
    switch (error.kind) {
      case "auth":
        return errorResponse(401, "liara_auth", fa.errors.unauthorized);
      case "forbidden":
        return errorResponse(403, error.code ?? "forbidden", fa.errors.forbidden);
      case "not_found":
        return errorResponse(404, "not_found", fa.errors.notFound);
      case "conflict":
        return errorResponse(409, "conflict", fa.errors.conflict);
      case "rate_limited":
        return errorResponse(429, "rate_limited", fa.errors.rateLimited, {
          retryAfterSec: error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1000) : undefined,
        });
      case "payment":
        return errorResponse(402, error.code ?? "payment", fa.errors.generic);
      case "validation":
        return errorResponse(400, error.code ?? "validation", fa.errors.badRequest);
      case "timeout":
        return errorResponse(504, "liara_timeout", fa.errors.liaraTimeout);
      case "network":
        return errorResponse(502, "liara_network", fa.errors.liaraUnavailable);
      case "server":
        return errorResponse(502, "liara_unavailable", fa.errors.liaraUnavailable);
      default:
        return errorResponse(502, error.code === "schema_mismatch" ? "liara_bad_response" : "liara_error", fa.errors.liaraBadResponse);
    }
  }
  console.error("[api] unexpected error", error instanceof Error ? error.name : typeof error);
  return errorResponse(500, "internal", fa.errors.generic);
}

export interface ApiContext {
  session: ValidSession;
  liara: LiaraClient;
  request: Request;
}

/**
 * `export const GET = api(async ({ liara, session, request }, { params }) => Response.json(...))`
 * - requires a session (401 otherwise)
 * - for non-GET/HEAD methods rejects cross-origin requests (403)
 * - converts thrown LiaraError / UnauthorizedError into safe JSON responses
 */
export function api<Rest extends unknown[]>(handler: (ctx: ApiContext, ...rest: Rest) => Promise<Response> | Response) {
  return async (request: Request, ...rest: Rest): Promise<Response> => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
        return errorResponse(403, "forbidden_origin", fa.errors.forbiddenOrigin);
      }
      const session = await requireSession();
      return await handler({ session, liara: liaraFor(session), request }, ...rest);
    } catch (error) {
      // Next's own control-flow errors (prerender bailout, redirect, notFound) must propagate, otherwise the route
      // would be answered with a 500 at build time instead of being treated as dynamic.
      unstable_rethrow(error);
      return toErrorResponse(error);
    }
  };
}
