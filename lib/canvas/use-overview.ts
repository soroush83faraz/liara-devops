"use client";

import { useQuery } from "@tanstack/react-query";
import type { Overview } from "./types";

export const OVERVIEW_POLL_MS = 30_000;
export const OVERVIEW_STALE_MS = 10_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    /** For 429: seconds the server asked us to wait. */
    readonly retryAfterSec?: number,
  ) {
    super(`api ${status}`);
    this.name = "ApiError";
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  if (!res.ok) {
    let code: string | undefined;
    let retryAfterSec: number | undefined;
    try {
      const err = ((await res.json()) as { error?: { code?: string; retryAfterSec?: unknown } }).error;
      code = err?.code;
      if (typeof err?.retryAfterSec === "number" && Number.isFinite(err.retryAfterSec) && err.retryAfterSec > 0) retryAfterSec = Math.min(3600, Math.ceil(err.retryAfterSec));
    } catch {
      // non-JSON error body
    }
    if (retryAfterSec === undefined) {
      const h = Number(res.headers.get("Retry-After"));
      if (Number.isFinite(h) && h > 0) retryAfterSec = Math.min(3600, Math.ceil(h));
    }
    throw new ApiError(res.status, code, retryAfterSec);
  }
  return (await res.json()) as T;
}

/** Overview polled every 30 s while the tab is visible (TanStack pauses interval refetch in hidden tabs). */
export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: () => fetchJson<Overview>("/api/overview"),
    staleTime: OVERVIEW_STALE_MS,
    refetchInterval: OVERVIEW_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
