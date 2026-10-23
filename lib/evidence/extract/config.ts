// config: env key presence/absence. Absence is inferred from log text; presence uses app env KEY names
// only (values are never read). Also "X not set, using default" style hints.
import { mergeOccurrence, occurrenceParams, type Occurrence } from "../lines";
import { draft, SIG } from "../observe";
import type { DraftObservation, ExtractContext } from "../types";
import { markSuspicious } from "../injection";
import { findMissingKeys } from "./missing-env";

// "PORT not set, using default 3000" / "Using default value for CACHE_TTL" / "REDIS_URL is empty"
const DEFAULTED = new RegExp(String.raw`\b(?<k>[A-Z][A-Z0-9_]{1,127})\b[^\n]{0,30}?(?:not set|not provided|missing|is empty)[^\n]{0,20}?(?:,|;|-)?\s*(?:using|falling back to|defaulting to) (?:the )?default`);
const USING_DEFAULT_FOR = new RegExp(String.raw`using (?:the )?default (?:value )?for ['"\x60]?(?<k>[A-Z][A-Z0-9_]{1,127})`, "i");

export function extractConfig(ctx: ExtractContext): DraftObservation[] {
  const out: DraftObservation[] = [];
  const keys = new Set(ctx.app?.envKeys ?? []);
  const haveKeys = Boolean(ctx.app);

  for (const m of findMissingKeys(ctx.logGroups, ctx.logs)) {
    if (!haveKeys) continue;
    const present = keys.has(m.key);
    // Derived from a log line: inherits that line's injection flag.
    const flagged = markSuspicious(m.occ.sample).suspicious;
    const d = draft("config", "liara:app", present ? "evidence.config.key_present" : "evidence.config.key_absent", present ? "info" : "warn",
      `${m.key}: ${present ? "defined in app variables" : "not defined in app variables"}`,
      { key: m.key, inAppEnv: present, [SIG]: !present }, m.occ.firstTs);
    out.push(flagged ? { ...d, flagged: true } : d);
  }

  const defaults = new Map<string, Occurrence>();
  for (const g of ctx.logGroups) {
    const k = DEFAULTED.exec(g.message)?.groups?.k ?? USING_DEFAULT_FOR.exec(g.message)?.groups?.k;
    if (k) defaults.set(k, mergeOccurrence(defaults.get(k), g));
  }
  for (const [key, occ] of defaults) {
    out.push(draft("config", "liara:logs", "evidence.config.default_used", "info", occ.sample,
      { key, inAppEnv: haveKeys ? keys.has(key) : undefined, ...occurrenceParams(occ), [SIG]: false }, occ.firstTs));
  }
  return out;
}
