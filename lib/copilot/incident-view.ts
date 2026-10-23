// Pure view-model helpers for the incident list and report.
import type { IncidentListItem } from "./api";

export type OutcomeKey = "none" | "pending" | "verified" | "not_verified" | "failed";

/** Outcome shown in the list. "verified" is the only value that may read as resolved. */
export function outcomeOf(item: Pick<IncidentListItem, "outcome" | "hasProposal">): OutcomeKey {
  if (item.outcome) return item.outcome;
  return item.hasProposal ? "pending" : "none";
}

export const OUTCOME_TONE: Record<OutcomeKey, "ok" | "warn" | "danger" | "neutral" | "accent"> = {
  verified: "ok",
  not_verified: "warn",
  failed: "danger",
  pending: "accent",
  none: "neutral",
};

/** Whole minutes between start and end (or now); null when the dates are unusable. */
export function durationMinutes(startedAt: string, resolvedAt?: string, now: number = Date.now()): number | null {
  const start = Date.parse(startedAt);
  const end = resolvedAt ? Date.parse(resolvedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}
