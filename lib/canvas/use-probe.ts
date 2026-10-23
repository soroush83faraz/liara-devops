"use client";

import { useEffect, useRef } from "react";
import { useHealthStore } from "./health-store";
import { dueServices, PROBE_BACKOFF_MS, PROBE_INTERVAL_MS } from "./probe-schedule";
import { ApiError, fetchJson } from "./use-overview";
import type { OverviewService, ProbeResult } from "./types";

const TICK_MS = 1_000;
/** A result older than two probe intervals is shown as stale, with its age. */
export const STALE_AFTER_MS = 2 * PROBE_INTERVAL_MS;

/** Which services get an HTTP probe: running-ish apps. Databases have no HTTP surface; stopped/building apps are skipped. */
export function isProbeable(s: Pick<OverviewService, "kind" | "status">): boolean {
  return s.kind === "app" && s.status !== "stopped" && s.status !== "building";
}

/**
 * Probes each probeable service immediately, then every 30 s, max 3 in flight (staggered by the slot limit).
 * Results land in `useHealthStore`. Pauses while the tab is hidden. The server resolves the URL: only ids are sent.
 */
export function useProbe(services: readonly OverviewService[] | undefined) {
  const idsKey = (services ?? []).filter(isProbeable).map((s) => s.id).sort().join("\n");
  const stopped = useRef(false);

  useEffect(() => {
    const ids = idsKey ? idsKey.split("\n") : [];
    const nextAt = new Map<string, number>();
    const inFlight = new Set<string>();
    stopped.current = false;
    useHealthStore.getState().prune(new Set(ids));

    async function probeOne(id: string) {
      inFlight.add(id);
      try {
        const result = await fetchJson<ProbeResult>("/api/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service: id }),
        });
        useHealthStore.getState().record(id, result);
        useHealthStore.getState().setSessionExpired(false);
        nextAt.set(id, Date.now() + PROBE_INTERVAL_MS);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // Session gone: stop probing and say so (the old badges age into "stale", they are never kept green).
          stopped.current = true;
          useHealthStore.getState().setSessionExpired(true);
        }
        // Our own probe call failed (rate limit, Liara error): not evidence about the site. Back off and keep the old state.
        nextAt.set(id, Date.now() + (error instanceof ApiError && error.status === 429 ? PROBE_BACKOFF_MS : PROBE_INTERVAL_MS));
      } finally {
        inFlight.delete(id);
      }
    }

    function tick() {
      useHealthStore.getState().markStale(Date.now(), STALE_AFTER_MS);
      if (stopped.current || document.visibilityState === "hidden") return;
      for (const id of dueServices(ids, { nextAt, inFlight }, Date.now())) void probeOne(id);
    }

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stopped.current = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [idsKey]);
}
