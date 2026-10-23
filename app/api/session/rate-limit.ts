// Tiny fixed-window in-memory rate limiter (per process). Enough for the connect endpoint;
// not a distributed limiter. Memory is bounded: expired windows are pruned on every call.

/** POST /api/session: attempts per minute per client address. */
export const SESSION_ATTEMPTS_PER_MINUTE = 10;
/** POST /api/session: attempts per minute over all clients (circuit breaker against distributed attempts). */
export const GLOBAL_SESSION_ATTEMPTS_PER_MINUTE = 120;
/** POST /api/session body cap: {token (<= 4096 chars), teamId (<= 64)} fits comfortably. */
export const SESSION_BODY_MAX_BYTES = 8 * 1024;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets (always >= 1 when blocked). */
  retryAfter: number;
}

export interface RateLimiter {
  hit(key: string, now?: number): RateLimitResult;
  reset(): void;
}

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  function prune(now: number) {
    for (const [key, w] of windows) {
      if (now - w.start >= windowMs) windows.delete(key);
    }
    // Hard cap: drop the oldest entries if an attacker rotates keys.
    while (windows.size > maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }

  return {
    hit(key, now = Date.now()) {
      prune(now);
      const current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return { allowed: true, remaining: limit - 1, retryAfter: 0 };
      }
      current.count += 1;
      if (current.count > limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil((current.start + windowMs - now) / 1000)),
        };
      }
      return { allowed: true, remaining: limit - current.count, retryAfter: 0 };
    },
    reset() {
      windows.clear();
    },
  };
}

/** Upper bound for TRUSTED_PROXY_HOPS (a longer chain is a misconfiguration, not a deployment). */
const MAX_PROXY_HOPS = 10;
/** Bucket shared by every request whose address cannot be trusted (no proxy configured / unusable header). */
export const UNTRUSTED_CLIENT = "untrusted";

/**
 * Number of reverse proxies in front of the server that APPEND the peer address to X-Forwarded-For
 * (`TRUSTED_PROXY_HOPS`, default 1 = Liara's ingress). 0 means the server is reached directly: every forwarding
 * header is then client-controlled and ignored. An invalid value falls back to the default (env-contract warns).
 */
export function trustedProxyHops(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = (env.TRUSTED_PROXY_HOPS ?? "").trim();
  if (!/^\d{1,2}$/.test(raw) || Number(raw) > MAX_PROXY_HOPS) return 1;
  return Number(raw);
}

/**
 * Client address for per-IP rate limiting. X-Forwarded-For is read FROM THE RIGHT: each trusted proxy appends the
 * address it saw, so the entry `hops` positions from the end is the one the outermost trusted proxy recorded.
 * Everything to its left was supplied by the client and is ignored (rotating spoofed leftmost entries therefore
 * lands in the same bucket). With hops = 0 nothing is trusted and all requests share one bucket; Next.js does not
 * expose the socket address to route handlers, so the global circuit limiter is the backstop in that mode.
 */
export function clientIp(headers: Headers, hops: number = trustedProxyHops()): string {
  if (!Number.isInteger(hops) || hops <= 0) return UNTRUSTED_CLIENT;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const parts = forwarded.split(",").map((s) => s.trim());
    // Fewer entries than trusted hops: the furthest hop we have is the best (Express `trust proxy` semantics).
    const picked = parts[Math.max(0, parts.length - hops)] ?? "";
    return normalizeAddress(picked);
  }
  const real = headers.get("x-real-ip");
  return real !== null ? normalizeAddress(real) : "unknown";
}

/** Bounded, canonical bucket key: lowercase, no brackets/port, at most 64 chars of address characters. */
function normalizeAddress(raw: string): string {
  let a = raw.trim().toLowerCase();
  const bracketed = /^\[([0-9a-f:.]+)\](?::\d+)?$/.exec(a);
  if (bracketed) a = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(a)) a = a.slice(0, a.lastIndexOf(":"));
  if (a === "" || a.length > 64 || !/^[0-9a-f:.]+$/.test(a)) return UNTRUSTED_CLIENT;
  return a;
}
