// Observation construction helpers, caps and deterministic id assignment. Pure.
import { OBSERVATION_PARAMS_MAX, OBSERVATION_TEXT_MAX } from "@/lib/contracts/observation";
import type { DraftObservation, Observation, ObservationKind, ObservationSource, Severity } from "./types";

/** Excerpt length per observation (the contract allows 4000; the UI and the LLM need far less). */
export const MAX_TEXT_PER_OBSERVATION = 600;
export const MAX_TOTAL_TEXT = 16_000;
export const MAX_OBSERVATIONS = 80;
export const DEFAULT_MAX_PER_KIND = 8;
export const MAX_PER_KIND: Partial<Record<ObservationKind, number>> = { log_error: 6, metric: 4, probe: 2, config: 8 };

/** Params marker for a direct signature of a cause (see levels.ts). */
export const SIG = "sig";

export function excerpt(text: string, max = MAX_TEXT_PER_OBSERVATION): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

type ParamValue = string | number | boolean | undefined | null;

/** Drops empty values, maps booleans to 0/1, truncates strings, keeps at most 24 keys (insertion order). */
export function cleanParams(p: Record<string, ParamValue>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (Object.keys(out).length >= OBSERVATION_PARAMS_MAX) break;
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "boolean") out[k] = v ? 1 : 0;
    else if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
    } else out[k] = v.length > 500 ? v.slice(0, 500) : v;
  }
  return out;
}

/** Canonical ISO-8601 UTC, or undefined for missing/unparseable/epoch values. */
export function toIso(ts: string | number | undefined | null): string | undefined {
  if (ts === undefined || ts === null || ts === "") return undefined;
  const ms = typeof ts === "number" ? ts : Date.parse(ts);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined;
}

export function draft(
  kind: ObservationKind,
  source: ObservationSource,
  summary: string,
  severity: Severity,
  text: string,
  params: Record<string, ParamValue>,
  ts?: string,
): DraftObservation {
  const iso = toIso(ts);
  return {
    kind,
    severity,
    ...(iso ? { ts: iso } : {}),
    source,
    summary,
    text: excerpt(text),
    params: cleanParams(params),
  };
}

/**
 * Applies the per-kind and total caps (first ones win, order preserved), bounds the total text size,
 * and assigns `O1..On` in order. Same input -> same ids.
 */
export function assignIds(drafts: readonly DraftObservation[]): Observation[] {
  const perKind = new Map<ObservationKind, number>();
  const out: Observation[] = [];
  let textBudget = MAX_TOTAL_TEXT;
  for (const d of drafts) {
    if (out.length >= MAX_OBSERVATIONS) break;
    const n = perKind.get(d.kind) ?? 0;
    if (n >= (MAX_PER_KIND[d.kind] ?? DEFAULT_MAX_PER_KIND)) continue;
    perKind.set(d.kind, n + 1);
    const limit = Math.min(OBSERVATION_TEXT_MAX, Math.max(0, textBudget));
    const text = d.text.length > limit ? (limit > 1 ? `${d.text.slice(0, limit - 1)}…` : "") : d.text;
    textBudget -= text.length;
    out.push({ id: `O${out.length + 1}`, ...d, text });
  }
  return out;
}

export const paramNum = (o: { params: Record<string, string | number> }, k: string): number | undefined => {
  const v = o.params[k];
  return typeof v === "number" ? v : undefined;
};
export const paramStr = (o: { params: Record<string, string | number> }, k: string): string | undefined => {
  const v = o.params[k];
  return typeof v === "string" ? v : undefined;
};
export const isSignature = (o: { params: Record<string, string | number>; flagged?: boolean }): boolean =>
  o.params[SIG] === 1 && !o.flagged;
