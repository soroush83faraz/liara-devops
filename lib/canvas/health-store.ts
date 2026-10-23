"use client";

import { create } from "zustand";
import type { ProbeResult } from "./types";

/**
 * ok = reachable (2xx/3xx) · degraded = reachable but 4xx · down = no answer (connect/timeout/TLS) or 5xx ·
 * unprobeable = the site cannot be probed at all (no public address, address refused by our guard, a name that
 * never resolved for a not-yet-deployed app): neutral, never a failure, never an alert · unknown = never probed.
 */
export type HealthState = "ok" | "degraded" | "down" | "unprobeable" | "unknown";

export interface ServiceHealth {
  status: HealthState;
  latencyMs?: number;
  checkedAt?: string;
  httpStatus?: number;
  error?: ProbeResult["error"];
  consecutiveFailures: number;
  /** A probe has returned ok/degraded at least once, so a later failure is a regression, not a cold start. */
  everHealthy: boolean;
  lastHealthyAt?: string;
  /** When our probe call last produced a result (epoch ms, client clock). */
  lastSuccessAt?: number;
  /** No fresh result for more than 2x the probe interval (our call failing, session lost, tab asleep). */
  stale?: boolean;
}

export interface HealthAlert {
  id: string;
  serviceId: string;
  raisedAt: string;
  dismissed: boolean;
  /** Set when the service answered again. */
  resolvedAt?: string;
}

/** Two consecutive failures turn a healthy service into an alert (one failure may be a blip). */
export const FAILURES_BEFORE_ALERT = 2;

export const EMPTY_HEALTH: ServiceHealth = { status: "unknown", consecutiveFailures: 0, everHealthy: false };

/** Probe outcomes that say "this site cannot be checked", not "this site is down". */
export const UNPROBEABLE_ERRORS: ReadonlySet<NonNullable<ProbeResult["error"]>> = new Set(["no_url", "blocked_address"]);

export function classifyProbe(result: Pick<ProbeResult, "ok" | "status" | "error">, everHealthy = false): HealthState {
  if (result.ok) return "ok";
  if (result.error && UNPROBEABLE_ERRORS.has(result.error)) return "unprobeable";
  // A name that never resolved (app not deployed yet / no DNS record) is not an outage; after it once answered, it is.
  if (result.error === "dns" && !everHealthy) return "unprobeable";
  if (result.status !== undefined && result.status >= 400 && result.status < 500) return "degraded";
  return "down";
}

/** Pure transition used by the store (and unit-tested). `raiseAlert` is true exactly once per failure episode. */
export function nextHealth(
  prev: ServiceHealth | undefined,
  result: ProbeResult,
  now: number = Date.now(),
): { health: ServiceHealth; raiseAlert: boolean; recovered: boolean } {
  const before = prev ?? EMPTY_HEALTH;
  // Our own probe budget was exhausted: says nothing about the site. Keep the previous state (it ages into stale).
  if (result.error === "rate_limited") return { health: before, raiseAlert: false, recovered: false };
  const status = classifyProbe(result, before.everHealthy);
  const failing = status === "down";
  const reachable = status === "ok" || status === "degraded";
  const consecutiveFailures = failing ? before.consecutiveFailures + 1 : 0;
  const health: ServiceHealth = {
    status,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
    httpStatus: result.status,
    error: result.error,
    consecutiveFailures,
    everHealthy: before.everHealthy || reachable,
    lastHealthyAt: reachable ? result.checkedAt : before.lastHealthyAt,
    lastSuccessAt: now,
    stale: false,
  };
  return {
    health,
    raiseAlert: failing && before.everHealthy && before.consecutiveFailures + 1 === FAILURES_BEFORE_ALERT,
    recovered: reachable && before.consecutiveFailures >= FAILURES_BEFORE_ALERT,
  };
}

/** True when the last result is older than `maxAgeMs` (the badge must then show its age, never a fresh-looking green). */
export function isStaleHealth(h: ServiceHealth | undefined, now: number, maxAgeMs: number): boolean {
  return !!h && h.status !== "unknown" && h.lastSuccessAt !== undefined && now - h.lastSuccessAt > maxAgeMs;
}

/** A service shows as failing in the UI once it reached the alert threshold. */
export const isFailing = (h: ServiceHealth | undefined): boolean =>
  !!h && h.status === "down" && h.consecutiveFailures >= FAILURES_BEFORE_ALERT;

interface HealthStore {
  byService: Record<string, ServiceHealth>;
  alerts: HealthAlert[];
  /** /api/probe answered 401: probing stopped; the UI must ask the user to reconnect. */
  sessionExpired: boolean;
  record: (serviceId: string, result: ProbeResult, now?: number) => void;
  /** Flags results older than `maxAgeMs` as stale (called on every scheduler tick). */
  markStale: (now: number, maxAgeMs: number) => void;
  setSessionExpired: (expired: boolean) => void;
  dismissAlert: (id: string) => void;
  dismissAll: () => void;
  /** Forget services that no longer exist. */
  prune: (existingIds: ReadonlySet<string>) => void;
}

let alertSeq = 0;

export const useHealthStore = create<HealthStore>((set) => ({
  byService: {},
  alerts: [],
  sessionExpired: false,
  setSessionExpired: (expired) => set((s) => (s.sessionExpired === expired ? s : { sessionExpired: expired })),
  markStale: (now, maxAgeMs) =>
    set((s) => {
      const changed = Object.entries(s.byService).filter(([, h]) => !h.stale && isStaleHealth(h, now, maxAgeMs));
      if (changed.length === 0) return s;
      return { byService: { ...s.byService, ...Object.fromEntries(changed.map(([k, h]) => [k, { ...h, stale: true }])) } };
    }),
  record: (serviceId, result, now) =>
    set((state) => {
      const { health, raiseAlert, recovered } = nextHealth(state.byService[serviceId], result, now);
      let alerts = state.alerts;
      if (raiseAlert) {
        alerts = [
          ...alerts,
          { id: `${serviceId}#${++alertSeq}`, serviceId, raisedAt: result.checkedAt, dismissed: false },
        ];
      } else if (recovered) {
        alerts = alerts.map((a) =>
          a.serviceId === serviceId && !a.resolvedAt ? { ...a, resolvedAt: result.checkedAt } : a,
        );
      }
      return { byService: { ...state.byService, [serviceId]: health }, alerts };
    }),
  dismissAlert: (id) => set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)) })),
  dismissAll: () => set((s) => ({ alerts: s.alerts.map((a) => ({ ...a, dismissed: true })) })),
  prune: (existing) =>
    set((s) => {
      const keys = Object.keys(s.byService);
      if (keys.every((k) => existing.has(k))) return s;
      return {
        byService: Object.fromEntries(Object.entries(s.byService).filter(([k]) => existing.has(k))),
        alerts: s.alerts.filter((a) => existing.has(a.serviceId)),
      };
    }),
}));

/** Alerts that still need attention: not dismissed and not resolved. */
export const activeAlerts = (alerts: readonly HealthAlert[]): HealthAlert[] =>
  alerts.filter((a) => !a.dismissed && !a.resolvedAt);
