"use client";
// Browser-side helpers for the config routes. Mutations here deliberately do NOT use react-query's
// useMutation: its cache keeps `variables`, which for env changes would hold secrets.
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, appPath, fetchJson } from "@/lib/service/app-read/client";
import { describeError, type DescribedError } from "./errors";
import type { DisksDto, DomainsListDto, EnvListDto, SettingsDto } from "./dto";

export { ApiError, appPath };

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
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

export const configKeys = {
  envs: (name: string) => ["app", name, "config", "envs"] as const,
  domains: (name: string) => ["app", name, "config", "domains"] as const,
  disks: (name: string) => ["app", name, "config", "disks"] as const,
  settings: (name: string) => ["app", name, "config", "settings"] as const,
  /** Prefix for everything the config tabs cache (and the overview, which shows plan/status). */
  all: (name: string) => ["app", name] as const,
};

export function useEnvList(name: string) {
  return useQuery({
    queryKey: configKeys.envs(name),
    queryFn: ({ signal }) => fetchJson<EnvListDto>(appPath(name, "envs"), signal),
  });
}
export function useDomainList(name: string) {
  return useQuery({
    queryKey: configKeys.domains(name),
    queryFn: ({ signal }) => fetchJson<DomainsListDto>(appPath(name, "domains"), signal),
  });
}
export function useDiskList(name: string) {
  return useQuery({
    queryKey: configKeys.disks(name),
    queryFn: ({ signal }) => fetchJson<DisksDto>(appPath(name, "disks"), signal),
  });
}
export function useSettings(name: string) {
  return useQuery({
    queryKey: configKeys.settings(name),
    queryFn: ({ signal }) => fetchJson<SettingsDto>(appPath(name, "settings"), signal),
  });
}

/**
 * Runs one async action with pending/error state. The action's inputs live in the caller's closure, not
 * here, so nothing secret is retained by this hook.
 */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DescribedError | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (alive.current) setError(describeError(e));
      throw e;
    } finally {
      if (alive.current) setPending(false);
    }
  }, []);
  const reset = useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}

/** Seconds left until `from` seconds after mount (remount the component to restart it). */
export function useCountdown(from: number | undefined): number {
  const [deadline] = useState(() => Date.now() + (from ?? 0) * 1000);
  const [now, setNow] = useState(() => Date.now());
  const active = !!from && from > 0 && now < deadline;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
