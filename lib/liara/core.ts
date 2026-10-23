import type { z } from "zod";
import { isRecord, sleep } from "./util";

export type LiaraErrorKind =
  | "auth"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payment"
  | "validation"
  | "server"
  | "timeout"
  | "network"
  | "unknown";

export interface LiaraErrorInit {
  status: number;
  kind: LiaraErrorKind;
  message: string;
  code?: string;
  body?: unknown;
  retryAfterMs?: number;
}

/** Normalised error for every failure of the Liara API client. Never contains the token. */
export class LiaraError extends Error {
  readonly status: number;
  readonly kind: LiaraErrorKind;
  readonly code?: string;
  readonly body?: unknown;
  readonly retryAfterMs?: number;

  constructor(init: LiaraErrorInit) {
    super(init.message);
    this.name = "LiaraError";
    this.status = init.status;
    this.kind = init.kind;
    this.code = init.code;
    this.body = init.body;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export const isLiaraError = (e: unknown): e is LiaraError => e instanceof LiaraError;

/** Client-side argument problem (nothing was sent). */
export const invalidArgument = (message: string): LiaraError =>
  new LiaraError({ status: 0, kind: "validation", code: "invalid_argument", message });

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  /** multipart upload body (deploy sources). */
  form?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LiaraClientOptions {
  token: string;
  /** Team id; omit/empty for the personal account (the CLI always sends `teamID=`). */
  teamId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxConcurrent?: number;
  /** GET-only retry policy. */
  retries?: number;
  retryBaseDelayMs?: number;
}

export interface LiaraClient {
  readonly baseUrl: string;
  readonly teamId: string;
  request<T>(method: HttpMethod, path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T>;
  get<T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T>;
  post<T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T>;
  patch<T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T>;
  delete<T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T>;
}

/** Maps an HTTP status (+ Liara body code) onto a coarse error kind. */
export function classify(status: number, code?: string): LiaraErrorKind {
  // [CLI] deploy.ts: 400 + message "frozen_project" == not enough balance.
  if (code === "frozen_project") return "payment";
  // [CLI] deploy.ts: 428 + data.code max_deployment_count_in_day / germany_builder_not_allowed.
  if (status === 428) {
    if (code === "max_deployment_count_in_day") return "rate_limited";
    if (code === "germany_builder_not_allowed") return "forbidden";
    return "validation";
  }
  if (status === 401) return "auth";
  if (status === 402) return "payment";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status >= 400) return "validation"; // 400, 413, 422, ...
  return "unknown";
}

function extractCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const data = body.data;
  if (isRecord(data) && typeof data.code === "string") return data.code;
  // [CLI] some errors put the code in `message` (e.g. "frozen_project").
  if (typeof body.message === "string" && /^[a-z0-9]+(_[a-z0-9]+)+$/.test(body.message)) return body.message;
  return undefined;
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  if (isRecord(body)) {
    const m = body.message;
    if (typeof m === "string" && m) return m.slice(0, 300);
    if (Array.isArray(m)) return m.filter((x) => typeof x === "string").join("; ").slice(0, 300);
  }
  return fallback;
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => waiting.push(r));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next(); // hand the slot over
      else active--;
    }
  };
}

export function createLiaraClient(options: LiaraClientOptions): LiaraClient {
  const {
    token,
    teamId = "",
    baseUrl = "https://api.liara.ir",
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    maxConcurrent = 3,
    retries = 2,
    retryBaseDelayMs = 500,
  } = options;
  if (!token) throw invalidArgument("Liara API token is required");
  const base = baseUrl.replace(/\/+$/, "");
  const limit = createLimiter(Math.max(1, maxConcurrent));

  const scrub = (s: string): string => (token ? s.split(token).join("[redacted]") : s);
  const scrubBody = (b: unknown): unknown => {
    if (b === undefined) return b;
    try {
      return JSON.parse(scrub(JSON.stringify(b)));
    } catch {
      return undefined;
    }
  };

  function buildUrl(path: string, query: RequestOptions["query"]): string {
    const url = new URL(base + (path.startsWith("/") ? path : `/${path}`));
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    url.searchParams.set("teamID", teamId); // [CLI] base.ts: always sent, empty for personal
    return url.toString();
  }

  async function attempt(method: HttpMethod, path: string, opts: RequestOptions): Promise<unknown> {
    const url = buildUrl(path, opts.query);
    const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    const where = `${method} ${new URL(url).pathname}`;

    let res: Response;
    let text: string;
    try {
      res = await limit(() => fetchImpl(url, { method, headers, body, signal }));
      text = await res.text();
    } catch (e) {
      if (opts.signal?.aborted) {
        throw new LiaraError({ status: 0, kind: "network", code: "aborted", message: `Liara ${where} aborted` });
      }
      if (timeoutSignal.aborted) {
        throw new LiaraError({ status: 0, kind: "timeout", code: "client_timeout", message: `Liara ${where} timed out` });
      }
      const detail = scrub(e instanceof Error ? e.message : String(e)).slice(0, 200);
      throw new LiaraError({ status: 0, kind: "network", message: `Liara ${where} network error: ${detail}` });
    }

    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text.slice(0, 500);
      }
    }
    if (!res.ok) {
      const code = extractCode(parsed);
      const msg = extractMessage(parsed, res.statusText || "request failed");
      throw new LiaraError({
        status: res.status,
        kind: classify(res.status, code),
        code,
        message: scrub(`Liara ${where} failed (${res.status}): ${msg}`),
        body: scrubBody(parsed),
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      });
    }
    return parsed;
  }

  const isTransient = (e: unknown): boolean =>
    isLiaraError(e) && (e.kind === "network" || e.kind === "timeout" || e.kind === "server" || e.status === 429) && e.code !== "aborted";

  async function request<T>(method: HttpMethod, path: string, schema: z.ZodType<T>, opts: RequestOptions = {}): Promise<T> {
    // Mutations are NEVER retried: a lost response may still have been applied.
    const maxRetries = method === "GET" ? retries : 0;
    for (let n = 0; ; n++) {
      try {
        const raw = await attempt(method, path, opts);
        const r = schema.safeParse(raw);
        if (r.success) return r.data;
        const paths = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(root)"))].slice(0, 5).join(", ");
        throw new LiaraError({
          status: 200,
          kind: "unknown",
          code: "schema_mismatch",
          message: `Liara ${method} ${path.split("?")[0]} returned an unexpected shape at: ${paths}`,
        });
      } catch (e) {
        if (n >= maxRetries || !isTransient(e) || opts.signal?.aborted) throw e;
        const le = e as LiaraError;
        const backoff = retryBaseDelayMs * 2 ** n * (0.75 + Math.random() * 0.5);
        await sleep(Math.min(10_000, le.retryAfterMs ?? backoff), opts.signal);
      }
    }
  }

  const bind = (m: HttpMethod) => <T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions) => request(m, path, schema, opts);
  return { baseUrl: base, teamId, request, get: bind("GET"), post: bind("POST"), patch: bind("PATCH"), delete: bind("DELETE") };
}
