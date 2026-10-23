import { ACTION_POLICY, isActionType, type ActionType, type Reversibility, type Tier } from "../contracts/action";

/**
 * Server-side policy gates for mutating routes: action allowlist, AI-proposal
 * restriction, typed-name confirmation, same-origin (CSRF) check, rate limiting.
 */

export type PolicyErrorCode = "unknown_action" | "ai_not_allowed" | "typed_name_mismatch" | "cross_origin" | "rate_limited";

export class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  /** Set for rate_limited. */
  readonly retryAfterMs?: number;
  /** Internal detail for logs (e.g. which origin check failed); not for clients. */
  declare readonly detail?: string;
  constructor(code: PolicyErrorCode, message: string, opts?: { retryAfterMs?: number; detail?: string }) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
    if (opts?.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    if (opts?.detail !== undefined) Object.defineProperty(this, "detail", { value: opts.detail, enumerable: false });
  }
}

/* -------------------------------------------------------------- actions */

export function assertKnownActionType(type: unknown): asserts type is ActionType {
  if (!isActionType(type)) throw new PolicyError("unknown_action", "unknown action type");
}

/** The copilot may only propose aiProposable types (never creations or deletes). */
export function assertAiMayPropose(type: unknown): asserts type is ActionType {
  assertKnownActionType(type);
  if (!ACTION_POLICY[type].aiProposable) throw new PolicyError("ai_not_allowed", "action not proposable by the assistant");
}

export interface ConfirmationRequirement {
  tier: Tier;
  /** User must type the exact resource name. */
  typedName: boolean;
  /** Dialog must show the hourly/monthly cost line. */
  costLine: boolean;
  reversible: Reversibility;
}

export function requiredConfirmation(type: ActionType): ConfirmationRequirement {
  assertKnownActionType(type);
  const p = ACTION_POLICY[type];
  return { tier: p.tier, typedName: p.requiresTypedName, costLine: p.billed, reversible: p.reversible };
}

/** Exact, case-sensitive match after trimming the typed value. */
export function assertTypedName(actual: unknown, expected: string): void {
  if (typeof expected !== "string" || expected.length === 0 || expected.trim() !== expected) {
    throw new TypeError("expected name must be a non-empty, trimmed string");
  }
  if (typeof actual !== "string" || actual.length > 512 || actual.trim() !== expected) {
    throw new PolicyError("typed_name_mismatch", "typed name does not match");
  }
}

/* --------------------------------------------------------------- origin */

export interface HeaderBag {
  get(name: string): string | null;
}

export interface RequestLike {
  headers: HeaderBag;
}

export interface OriginCheckOptions {
  /** Exact allowed origins (scheme://host[:port]). Defaults to env APP_ORIGIN (comma-separated). */
  allowedOrigins?: readonly string[];
}

export type OriginCheckResult =
  | { ok: true }
  | { ok: false; reason: "cross_site" | "missing_origin" | "bad_origin" | "origin_mismatch" | "missing_host" };

function configuredOrigins(opts?: OriginCheckOptions): string[] {
  const raw = opts?.allowedOrigins ?? (process.env.APP_ORIGIN ?? "").split(",");
  const out: string[] = [];
  for (const o of raw) {
    const t = o.trim();
    if (!t) continue;
    try {
      out.push(new URL(t).origin);
    } catch {
      // ignore malformed configuration entries
    }
  }
  return out;
}

/**
 * CSRF gate for mutating routes. Rejects any `Sec-Fetch-Site` other than
 * same-origin/none; note that sibling apps on *.liara.run may be "same-site", so
 * SameSite cookies alone do not protect us. With an Origin header, it must equal
 * APP_ORIGIN (when configured) or the request's own Host / X-Forwarded-Host.
 * Without Origin, the request passes only when Sec-Fetch-Site is same-origin/none.
 */
export function checkSameOrigin(req: RequestLike, opts?: OriginCheckOptions): OriginCheckResult {
  const h = req.headers;
  const site = h.get("sec-fetch-site")?.trim().toLowerCase() ?? null;
  if (site !== null && site !== "same-origin" && site !== "none") return { ok: false, reason: "cross_site" };

  const origin = h.get("origin")?.trim() ?? null;
  if (origin === null || origin === "") {
    return site === "same-origin" || site === "none" ? { ok: true } : { ok: false, reason: "missing_origin" };
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, reason: "bad_origin" };
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== origin.toLowerCase()) {
    return { ok: false, reason: "bad_origin" };
  }

  const allowed = configuredOrigins(opts);
  if (allowed.length > 0) return allowed.includes(parsed.origin) ? { ok: true } : { ok: false, reason: "origin_mismatch" };

  const hostHeader = (h.get("x-forwarded-host") ?? h.get("host"))?.split(",")[0]?.trim();
  if (!hostHeader) return { ok: false, reason: "missing_host" };
  let requestHost: string;
  try {
    requestHost = new URL(`${parsed.protocol}//${hostHeader}`).host;
  } catch {
    return { ok: false, reason: "missing_host" };
  }
  return parsed.host === requestHost ? { ok: true } : { ok: false, reason: "origin_mismatch" };
}

export function assertSameOrigin(req: RequestLike, opts?: OriginCheckOptions): void {
  const r = checkSameOrigin(req, opts);
  if (!r.ok) throw new PolicyError("cross_origin", "cross-origin request rejected", { detail: r.reason });
}

/* ----------------------------------------------------------- rate limit */

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** 0 when ok. */
  retryAfterMs: number;
}

const RATE_LIMIT_KEY = Symbol.for("hamyar.ratelimit.v1");
const RATE_LIMIT_MAX_KEYS = 50_000;

function rateTable(): Map<string, number[]> {
  const g = globalThis as unknown as Record<symbol, Map<string, number[]> | undefined>;
  let t = g[RATE_LIMIT_KEY];
  if (!t) {
    t = new Map();
    g[RATE_LIMIT_KEY] = t;
  }
  return t;
}

/**
 * In-memory sliding-window limiter (per process). Namespace keys by purpose,
 * e.g. `agent:${accountId}`, `approve:${accountId}`.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) throw new TypeError("invalid rate-limit key");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new RangeError("invalid limit");
  if (!Number.isInteger(windowMs) || windowMs < 1 || windowMs > 86_400_000) throw new RangeError("invalid window");

  const table = rateTable();
  const hits = table.get(key) ?? [];
  table.delete(key); // re-inserted below: Map order doubles as LRU order
  const cutoff = now - windowMs;
  let firstLive = 0;
  while (firstLive < hits.length && hits[firstLive] <= cutoff) firstLive++;
  const live = firstLive > 0 ? hits.slice(firstLive) : hits;

  let result: RateLimitResult;
  if (live.length < limit) {
    live.push(now);
    result = { ok: true, limit, remaining: limit - live.length, retryAfterMs: 0 };
  } else {
    result = { ok: false, limit, remaining: 0, retryAfterMs: Math.max(1, live[0] + windowMs - now) };
  }
  table.set(key, live);
  while (table.size > RATE_LIMIT_MAX_KEYS) {
    const oldest = table.keys().next().value;
    if (oldest === undefined) break;
    table.delete(oldest);
  }
  return result;
}

export function assertRateLimit(key: string, limit: number, windowMs: number, now?: number): RateLimitResult {
  const r = rateLimit(key, limit, windowMs, now);
  if (!r.ok) throw new PolicyError("rate_limited", "rate limit exceeded", { retryAfterMs: r.retryAfterMs });
  return r;
}
