// probe: HTTP health probe of the app's own address (status code, latency, redirects, timeouts).
import { draft } from "../observe";
import type { DraftObservation, ExtractContext } from "../types";
import { isUnreachable } from "./port-mismatch";

export const SLOW_PROBE_MS = 3000;

export function extractProbe(ctx: ExtractContext): DraftObservation[] {
  const p = ctx.probe;
  if (!p) return [];
  const status = p.status;
  let summary: string;
  let severity: "info" | "warn" | "error";
  if (p.error === "no_url" || p.error === "blocked_address" || p.error === "rate_limited") {
    summary = `evidence.probe.skipped_${p.error}`;
    severity = "info";
  } else if (p.error) {
    summary = `evidence.probe.${p.error}`;
    severity = "error";
  } else if (status !== undefined && status >= 500) {
    summary = "evidence.probe.5xx";
    severity = "error";
  } else if (status !== undefined && status >= 400) {
    summary = "evidence.probe.4xx";
    severity = "warn";
  } else if (status !== undefined && status >= 300) {
    summary = "evidence.probe.redirect";
    severity = "info";
  } else if (p.latencyMs >= SLOW_PROBE_MS) {
    summary = "evidence.probe.slow";
    severity = "warn";
  } else {
    summary = "evidence.probe.ok";
    severity = "info";
  }
  return [
    draft("probe", "probe", summary, severity, `GET / -> ${status ?? p.error ?? "?"} in ${p.latencyMs} ms`, {
      ok: p.ok,
      status,
      error: p.error,
      latencyMs: p.latencyMs,
      slow: p.latencyMs >= SLOW_PROBE_MS,
      redirect: status !== undefined && status >= 300 && status < 400,
      // 502/503/504/refused/timeout: the platform could not reach the app at all (vs. an app-generated 5xx).
      unreachable: isUnreachable(p),
      checkedAt: p.checkedAt,
    }, p.checkedAt),
  ];
}
