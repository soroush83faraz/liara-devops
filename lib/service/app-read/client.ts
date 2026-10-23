// Browser-side fetch helper for the app-read routes. Error bodies are `{error:{code,message}}` (already safe/Persian).
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSec?: number;
  constructor(status: number, message: string, code?: string, retryAfterSec?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "network");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; retryAfterSec?: number } } | undefined)?.error;
    throw new ApiError(res.status, err?.message ?? String(res.status), err?.code, err?.retryAfterSec);
  }
  return body as T;
}

export const appPath = (name: string, sub: string) => `/api/apps/${encodeURIComponent(name)}/${sub}`;
