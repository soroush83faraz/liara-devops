// Summary-row counts. Same attention rule as the canvas cards (components/canvas/service-node.tsx `needsAttention`):
// Liara says failed/unhealthy, or two probes in a row got no answer.
import type { ServiceStatus } from "@/components/ui/status";

export interface SummaryService {
  id: string;
  status: ServiceStatus;
}

/**
 * Error-scan result. `unknown` = no service was scanned successfully (not started, failed, or nothing scannable):
 * that is never shown as 0. `known` counts only services whose scan succeeded; databases (never scanned) and services
 * beyond the per-response cap are in `total` but not in `scanned`.
 */
export type ErrorScanSummary = { kind: "unknown" } | { kind: "known"; withErrors: number; scanned: number; total: number };

export interface Summary {
  total: number;
  healthy: number;
  unhealthy: number;
  errors: ErrorScanSummary;
}

export const isUnhealthy = (status: ServiceStatus, probeFailing: boolean): boolean =>
  status === "failed" || status === "unhealthy" || probeFailing;

/**
 * healthy = running/healthy and not flagged; stopped, building and unknown services count only in `total`.
 * `scan` maps service id -> error-line count for services whose scan SUCCEEDED only (omit failed ones).
 * `unseen` = services matching the filter that the response did not include (cap), they were not scanned either.
 */
export function summarize(
  services: readonly SummaryService[],
  probeFailing: (id: string) => boolean,
  scan?: ReadonlyMap<string, number> | null,
  unseen = 0,
): Summary {
  let healthy = 0;
  let unhealthy = 0;
  let withErrors = 0;
  let scanned = 0;
  for (const s of services) {
    if (isUnhealthy(s.status, probeFailing(s.id))) unhealthy++;
    else if (s.status === "running" || s.status === "healthy") healthy++;
    const count = scan?.get(s.id);
    if (count !== undefined) {
      scanned++;
      if (count > 0) withErrors++;
    }
  }
  const errors: ErrorScanSummary = scanned === 0 ? { kind: "unknown" } : { kind: "known", withErrors, scanned, total: services.length + Math.max(0, unseen) };
  return { total: services.length, healthy, unhealthy, errors };
}
