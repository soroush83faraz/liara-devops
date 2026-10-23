// Turns machine codes (reasons, warnings, notes, sizing, errors) into Persian sentences via setupFlow strings.
// Server and client safe (no I/O). Unknown codes fall back to a neutral sentence instead of leaking the code.
import { fa } from "@/lib/i18n/fa";
import { faNumber } from "@/lib/i18n/format";
import type { Reason } from "./types";

const S = fa.setupFlow;

function fill(template: string, params: Record<string, string | number | undefined> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    if (v === undefined) return "";
    return typeof v === "number" ? faNumber(v) : v;
  });
}

const lookup = (group: Readonly<Record<string, string>>, code: string): string | undefined => (Object.prototype.hasOwnProperty.call(group, code) ? group[code] : undefined);

export const platformName = (p: string): string => lookup(S.platforms, p) ?? p;
export const engineName = (e: string): string => lookup(S.engines, e) ?? e;

export function reasonText(r: Reason): string {
  const template = lookup(S.reasons, r.code) ?? S.reasons.unknown;
  return fill(template, { file: r.file, detail: r.detail });
}

export const warningText = (code: string): string => lookup(S.warnings, code) ?? S.errors.generic;
export const noteText = (code: string): string => lookup(S.notes, code) ?? "";
export const errorText = (code: string | undefined): string => (code ? lookup(S.errors, code) : undefined) ?? S.errors.generic;
export const envHelpText = (key: string | undefined): string | undefined => (key ? lookup(S.envHelp, key) : undefined);
export const domainStepText = (key: string): string => lookup(S.domainSteps, key) ?? "";

/** Sizing reasons: `need_base_<platform>` and adjusters, plus plan_* and db_min_ram. */
export function sizingText(r: Reason, ctx: { ramGb?: number; cpu?: number } = {}): string {
  if (r.code.startsWith("need_base_")) {
    const platform = r.code.slice("need_base_".length);
    return fill(S.sizing.need_base, { platform: platformName(platform), ram: ctx.ramGb, cpu: ctx.cpu });
  }
  if (r.code === "db_min_ram") return fill(S.sizing.db_min_ram, { engine: engineName(r.detail ?? "") });
  return lookup(S.sizing, r.code) ?? "";
}

export const confidenceLevel = (c: number): "High" | "Medium" | "Low" => (c >= 0.8 ? "High" : c >= 0.5 ? "Medium" : "Low");
