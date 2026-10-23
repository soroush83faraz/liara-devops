// Shared HTTP plumbing for the actions routes: deps, strict origin + rate-limit guard, bounded JSON body
// reading, and error mapping that never includes upstream text or secret values.
import type { LiaraClient } from "@/lib/liara";
import type { ValidSession } from "@/lib/session";
import { errorResponse, toErrorResponse } from "@/lib/server/liara";
import { assertSameOrigin, rateLimit } from "@/lib/security/policy";
import { redactDeep } from "@/lib/security/redact";
import { getDefaultStore } from "@/lib/security/store";
import { ActionError, FlowError } from "../errors";
import type { JobDeps } from "../job";
import { MESSAGES, flowMessageFor, messageFor } from "../messages";
import type { FlowScope } from "../proposals";

/** Same shape as lib/server/liara ApiContext. */
export interface RouteCtx {
  session: ValidSession;
  liara: LiaraClient;
  request: Request;
}

export interface HttpDeps extends JobDeps {
  /** Keeps the background job tracked (routes pass `(job) => after(job)`). */
  schedule: (job: () => Promise<void>) => void;
  /** Exact allowed origins; defaults to env APP_ORIGIN, else the request's own host. */
  allowedOrigins?: readonly string[];
}

export function defaultHttpDeps(schedule?: HttpDeps["schedule"]): HttpDeps {
  return { store: getDefaultStore(), now: Date.now, schedule: schedule ?? ((job) => void job()) };
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export const scopeOf = (session: ValidSession): FlowScope => ({ accountId: session.accountId, teamId: session.teamId ?? "" });

/**
 * Mutating routes: the strict same-origin check of lib/security (Sec-Fetch-Site + Origin vs APP_ORIGIN/Host),
 * on top of api()'s check, then a per-account sliding-window rate limit.
 */
export function guardMutation(ctx: RouteCtx, deps: HttpDeps, bucket: string, limitPerMinute: number): Response | undefined {
  try {
    assertSameOrigin(ctx.request, deps.allowedOrigins ? { allowedOrigins: deps.allowedOrigins } : undefined);
  } catch {
    return errorResponse(403, "forbidden_origin", MESSAGES.forbiddenOrigin);
  }
  const r = rateLimit(`actions.${bucket}:${ctx.session.accountId}`, limitPerMinute, 60_000, deps.now());
  if (!r.ok) return errorResponse(429, "rate_limited", MESSAGES.rateLimited, { retryAfterSec: Math.ceil(r.retryAfterMs / 1000) });
  return undefined;
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/** Reads at most `maxBytes`; a non-empty body must be application/json and valid UTF-8 JSON. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const tooLarge = (): BodyResult => ({ ok: false, response: errorResponse(413, "too_large", MESSAGES.badRequest) });
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return tooLarge();
  if (!request.body) return { ok: true, value: undefined };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return tooLarge();
    }
    chunks.push(value);
  }
  if (total === 0) return { ok: true, value: undefined };
  if (!/^application\/json(?:\s*;|$)/i.test((request.headers.get("content-type") ?? "").trim())) {
    return { ok: false, response: errorResponse(415, "unsupported_media_type", MESSAGES.badRequest) };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, response: errorResponse(400, "bad_json", MESSAGES.badRequest) };
  }
}

/** 400 naming only the first failing field path (never the submitted value). */
export function badRequest(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): Response {
  const path = issues[0]?.path.map((p) => String(p)).join(".").slice(0, 120) ?? "";
  return errorResponse(400, "bad_request", MESSAGES.badRequest, path ? { field: path } : undefined);
}

export function actionErrorResponse(err: ActionError): Response {
  const knownSecrets = err.knownSecrets;
  const extra: Record<string, unknown> = {};
  if (err.details) extra.details = redactDeep(err.details, { knownSecrets });
  if (err.after) extra.after = redactDeep(err.after, { knownSecrets });
  if (err.retryAfterSec !== undefined) extra.retryAfterSec = err.retryAfterSec;
  return errorResponse(err.status, err.code, messageFor(err.code), extra);
}

export function errorToResponse(e: unknown): Response {
  if (e instanceof FlowError) return errorResponse(e.status, e.code, flowMessageFor(e.code), e.details ? { details: e.details } : undefined);
  if (e instanceof ActionError) return actionErrorResponse(e);
  return toErrorResponse(e);
}

export function parseLimit(url: string, def: number, max: number): number {
  const raw = new URL(url).searchParams.get("limit");
  const n = raw === null ? def : Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : def;
}
