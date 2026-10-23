// Browser-side helpers for the db routes. Errors reuse the app-read ApiError (safe Persian messages from the server).
import { ApiError } from "../app-read/client";

export { ApiError, fetchJson } from "../app-read/client";

export const dbPath = (host: string, sub: string) => `/api/dbs/${encodeURIComponent(host)}/${sub}`;

export const dbKeys = {
  all: (host: string) => ["db", host] as const,
  overview: (host: string) => ["db", host, "overview"] as const,
  connection: (host: string) => ["db", host, "connection"] as const,
  metrics: (host: string, range: string) => ["db", host, "metrics", range] as const,
  events: (host: string) => ["db", host, "events"] as const,
  backups: (host: string) => ["db", host, "backups"] as const,
  plans: (host: string) => ["db", host, "plans"] as const,
};

/** POST JSON; resolves with the parsed body, rejects with ApiError (status 0 = network). */
export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "network");
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string; retryAfterSec?: number } } | undefined)?.error;
    throw new ApiError(res.status, err?.message ?? String(res.status), err?.code, err?.retryAfterSec);
  }
  return parsed as T;
}
