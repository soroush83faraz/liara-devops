// missing-env: the app says an environment variable is absent. Works on redacted log text only.
import { mergeOccurrence, occurrenceParams, type Occurrence } from "../lines";
import { draft, SIG } from "../observe";
import type { DraftObservation, EvidenceLine, ExtractContext, LogGroup } from "../types";

const KEY = String.raw`[A-Za-z_][A-Za-z0-9_]{1,127}`;
/** Upper-case identifiers look like env keys; mixed/lower case are usually code variables. */
const ENV_LIKE = /^[A-Z][A-Z0-9_]*$/;

interface Hit {
  key: string;
  pattern: string;
  /** False when the match is only a hint (e.g. KeyError without os.environ context). */
  strong: boolean;
}

// Each pattern names the key in group `k`. Patterns run on one (bounded) line.
const LINE_PATTERNS: Array<{ name: string; re: RegExp; envLikeOnly?: boolean }> = [
  // Generic: "Missing required environment variable: X" / "env var X is required" / "Missing env variables: A, B"
  {
    name: "generic",
    re: new RegExp(String.raw`(?:missing|required|undefined|unset|no)\s+(?:required\s+)?(?:environment|env)\.?\s*(?:variables?|vars?|keys?|settings?)\s*[:=]?\s*[\[\(]?['"\x60]?(?<k>${KEY}(?:['"\x60]?\s*,\s*['"\x60]?${KEY}){0,9})`, "i"),
  },
  {
    name: "generic_suffix",
    re: new RegExp(String.raw`(?:environment|env)\.?\s*(?:variable|var|key)\s+['"\x60]?(?<k>${KEY})['"\x60]?\s+(?:is\s+|was\s+)?(?:missing|not\s+set|not\s+defined|required|undefined|empty)`, "i"),
  },
  // Node: "process.env.X is undefined" / "process.env.X must be set"
  {
    name: "node_process_env",
    re: new RegExp(String.raw`process\.env(?:\.|\[['"])(?<k>${KEY})(?:['"]\])?[^\n]{0,40}?\b(?:undefined|missing|not\s+(?:set|defined)|required|empty|must\s+be\s+(?:set|defined|provided))`, "i"),
  },
  // Node/any: "X is not defined" / "X must be set" / "X is required" / "X not set" (env-like keys only)
  {
    name: "key_not_set",
    re: new RegExp(String.raw`(?:^|[\s:'"\x60(\[])(?<k>[A-Z][A-Z0-9_]{1,127})['"\x60]?\s+(?:is\s+|was\s+)?(?:not\s+(?:defined|set|provided|configured)|undefined|missing|required|must\s+be\s+(?:set|defined|provided))\b`),
    envLikeOnly: true,
  },
  // PHP 8 "$_ENV[...]": Undefined array key "X"; PHP 7: Undefined index: X
  { name: "php_undefined_key", re: new RegExp(String.raw`Undefined (?:array key|index):?\s*['"]?(?<k>[A-Z][A-Z0-9_]{1,127})['"]?`), envLikeOnly: true },
  // Django: ImproperlyConfigured: The SECRET_KEY setting must not be empty / Set the X environment variable
  { name: "django_setting", re: new RegExp(String.raw`ImproperlyConfigured:?\s*(?:The\s+)?(?<k>[A-Z][A-Z0-9_]{1,127})\s+setting must not be empty`) },
  { name: "django_set_env", re: new RegExp(String.raw`ImproperlyConfigured:?\s*Set the (?<k>[A-Z][A-Z0-9_]{1,127}) environment variable`) },
];

const DEFAULTED_HINT = /\b(?:using|falling back to|defaulting to|use) (?:the )?default\b/i;
const LARAVEL_APP_KEY = /No application encryption key has been specified/i;
const PY_KEYERROR = new RegExp(String.raw`\bKeyError:\s*['"](?<k>[A-Za-z_][A-Za-z0-9_]{1,127})['"]`);
const PY_ENV_CONTEXT = /os\.environ|environ\[|getenv|os\.getenv|env\(/;
// "ReferenceError: foo is not defined" is a code bug, not configuration (unless the name is env-like with "_").
const REFERENCE_ERROR = /ReferenceError/;

/** Pure parser shared by the extractor, `config` and the hypothesis rules. */
export function parseMissingEnv(message: string, context: readonly string[] = []): Hit[] {
  const hits: Hit[] = [];
  // "X not set, using default" is handled (as info) by the config extractor, not an error.
  if (DEFAULTED_HINT.test(message)) return hits;
  const push = (key: string, pattern: string, strong = true) => {
    if (!hits.some((h) => h.key === key)) hits.push({ key, pattern, strong });
  };
  if (LARAVEL_APP_KEY.test(message)) push("APP_KEY", "laravel_app_key");
  for (const { name, re, envLikeOnly } of LINE_PATTERNS) {
    const m = re.exec(message);
    const raw = m?.groups?.k;
    if (!raw) continue;
    for (const k of raw.split(/['"\x60]?\s*,\s*['"\x60]?/)) {
      const key = k.replace(/['"\x60]/g, "");
      if (!key || (envLikeOnly && !ENV_LIKE.test(key))) continue;
      if (name === "key_not_set" && REFERENCE_ERROR.test(message) && !key.includes("_")) continue;
      push(key, name);
    }
  }
  const ke = PY_KEYERROR.exec(message);
  if (ke?.groups?.k && ENV_LIKE.test(ke.groups.k)) {
    const withContext = PY_ENV_CONTEXT.test(message) || context.some((c) => PY_ENV_CONTEXT.test(c));
    push(ke.groups.k, withContext ? "python_keyerror_environ" : "python_keyerror", withContext);
  }
  return hits;
}

/** The up-to-4 lines before `index` (Python tracebacks name `os.environ[...]` just above the KeyError). */
export function contextBefore(lines: readonly EvidenceLine[], index: number, n = 4): string[] {
  return lines.slice(Math.max(0, index - n), index).map((l) => l.message);
}

export interface MissingKey {
  key: string;
  pattern: string;
  strong: boolean;
  occ: Occurrence;
}

/** Missing keys across grouped lines, merged per key (first-appearance order). */
export function findMissingKeys(groups: readonly LogGroup[], lines: readonly EvidenceLine[]): MissingKey[] {
  const byKey = new Map<string, MissingKey>();
  for (const g of groups) {
    for (const hit of parseMissingEnv(g.message, contextBefore(lines, g.firstIndex))) {
      const prev = byKey.get(hit.key);
      byKey.set(hit.key, {
        key: hit.key,
        pattern: prev?.strong ? prev.pattern : hit.pattern,
        strong: (prev?.strong ?? false) || hit.strong,
        occ: mergeOccurrence(prev?.occ, g),
      });
    }
  }
  return [...byKey.values()];
}

export function extractMissingEnv(ctx: ExtractContext): DraftObservation[] {
  return findMissingKeys(ctx.logGroups, ctx.logs).map((m) =>
    draft(
      "missing_env",
      "liara:logs",
      "evidence.missing_env",
      "error",
      m.occ.sample,
      { key: m.key, pattern: m.pattern, ...occurrenceParams(m.occ), [SIG]: m.strong },
      m.occ.firstTs,
    ),
  );
}
