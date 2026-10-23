// Pure helpers for the activity (audit) page: labels and filtering. Entries are shown exactly as stored
// (the server redacted them); nothing here reveals or reconstructs a value.
import { ACTION_TYPES, REDACTED_MARKER, type AuditEntry, type AuditResult } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";

export function auditActionLabel(code: string): { label: string; known: boolean } {
  if ((ACTION_TYPES as readonly string[]).includes(code)) return { label: fa.copilotUi.actions[code as (typeof ACTION_TYPES)[number]], known: true };
  const extra = (fa.activity.actions as Record<string, string>)[code];
  return extra ? { label: extra, known: true } : { label: code, known: false };
}

export const isRedactedName = (name: string): boolean => name === REDACTED_MARKER;

export interface AuditFilters {
  action: string;
  result: AuditResult | "all";
}

export const NO_FILTERS: AuditFilters = { action: "all", result: "all" };

export function filterAudit(entries: readonly AuditEntry[], f: AuditFilters): AuditEntry[] {
  return entries.filter((e) => (f.action === "all" || e.action === f.action) && (f.result === "all" || e.result === f.result));
}

/** Distinct action codes in the data, sorted for stable menus. */
export function distinctActions(entries: readonly AuditEntry[]): string[] {
  return [...new Set(entries.map((e) => e.action))].sort();
}

export const isFiltering = (f: AuditFilters): boolean => f.action !== "all" || f.result !== "all";
