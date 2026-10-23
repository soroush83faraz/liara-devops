// Pure helpers for environment variables: key validation, `.env` text parsing, diff building and the
// `set_env` request builder. No I/O. Values pass through here but are never logged and never put in issues.
import type { ActionParams } from "@/lib/contracts";
import { FORBIDDEN_RECORD_KEYS } from "@/lib/contracts/common";
import { isPublicEnvKey, MAX_ENV_CHANGES, MAX_ENV_VALUE_LENGTH } from "@/lib/contracts/env";

export { isPublicEnvKey, MAX_ENV_CHANGES, MAX_ENV_VALUE_LENGTH };

export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export type EnvKeyIssue = "empty" | "bad_chars" | "too_long" | "reserved";

/** null when the key is acceptable for `set_env` (same rule as the action contract). */
export function envKeyIssue(key: string): EnvKeyIssue | null {
  if (key.length === 0) return "empty";
  if (key.length > 128) return "too_long";
  if (!ENV_KEY_RE.test(key)) return "bad_chars";
  return FORBIDDEN_RECORD_KEYS.has(key) ? "reserved" : null;
}

export const isValidEnvKey = (key: string): boolean => envKeyIssue(key) === null;

/** Value check shared by the add/edit form and the importer. */
export function envValueIssue(value: string): "too_long" | "nul" | null {
  if (value.length > MAX_ENV_VALUE_LENGTH) return "too_long";
  if (value.includes("\u0000")) return "nul";
  return null;
}

export interface EnvEntry {
  key: string;
  value: string;
  /** 1-based line of the (last) definition. */
  line: number;
}

export type ParseIssueCode =
  | "invalid_key"
  | "no_equals"
  | "multiline"
  | "bad_quote"
  | "value_too_long"
  | "nul"
  | "duplicate";

export interface ParseIssue {
  line: number;
  code: ParseIssueCode;
  /** `duplicate` is resolved (last definition wins) and does not block; every other code skips the line. */
  severity: "error" | "warning";
  /** Only set for invalid_key / duplicate; truncated. Never a value. */
  key?: string;
}

export interface ParseResult {
  entries: EnvEntry[];
  issues: ParseIssue[];
}

const EXPORT_PREFIX = /^export\s+/;

function unescapeDouble(raw: string): string {
  // Only \" and \\ are unescaped. `\n` stays literal: values must remain single-line.
  return raw.replace(/\\(["\\])/g, "$1");
}

/** Finds the closing quote on one line; returns the index or -1. Double quotes honour backslash escapes. */
function closingQuote(rest: string, quote: '"' | "'"): number {
  for (let i = 1; i < rest.length; i++) {
    const c = rest[i];
    if (quote === '"' && c === "\\") {
      i++;
      continue;
    }
    if (c === quote) return i;
  }
  return -1;
}

/**
 * Parses pasted `.env` text. Supported: `KEY=value`, `export KEY=value`, single/double quotes, `# comments`
 * (full-line and trailing after whitespace for unquoted/quoted values), blank lines, CRLF.
 * Not supported (reported, line skipped): values spanning several lines. Duplicates: the last one wins.
 */
export function parseDotenv(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const byKey = new Map<string, EnvEntry>();
  const order: string[] = [];
  const issues: ParseIssue[] = [];
  let skipUntilQuote: '"' | "'" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];

    if (skipUntilQuote) {
      // Inside a rejected multi-line value: consume until a line that closes the quote.
      if (closingQuote(`${skipUntilQuote}${raw}`, skipUntilQuote) !== -1) skipUntilQuote = null;
      continue;
    }

    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const body = trimmed.replace(EXPORT_PREFIX, "");
    const eq = body.indexOf("=");
    if (eq === -1) {
      issues.push({ line: lineNo, code: "no_equals", severity: "error" });
      continue;
    }
    const key = body.slice(0, eq).trim();
    if (!isValidEnvKey(key)) {
      issues.push({ line: lineNo, code: "invalid_key", severity: "error", key: key.slice(0, 40) });
      // A quoted multi-line value may start on an invalid-key line; keep scanning normally (cannot know).
      continue;
    }

    const rest = body.slice(eq + 1).trimStart();
    let value: string;
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quote = rest[0] as '"' | "'";
      const end = closingQuote(rest, quote);
      if (end === -1) {
        issues.push({ line: lineNo, code: "multiline", severity: "error" });
        skipUntilQuote = quote;
        continue;
      }
      const after = rest.slice(end + 1).trim();
      if (after !== "" && !after.startsWith("#")) {
        issues.push({ line: lineNo, code: "bad_quote", severity: "error" });
        continue;
      }
      const inner = rest.slice(1, end);
      value = quote === '"' ? unescapeDouble(inner) : inner;
    } else {
      const hash = rest.search(/\s#/);
      value = (hash === -1 ? rest : rest.slice(0, hash)).trim();
    }

    const vIssue = envValueIssue(value);
    if (vIssue) {
      issues.push({ line: lineNo, code: vIssue === "nul" ? "nul" : "value_too_long", severity: "error" });
      continue;
    }

    const prev = byKey.get(key);
    if (prev) {
      issues.push({ line: lineNo, code: "duplicate", severity: "warning", key });
      prev.value = value;
      prev.line = lineNo;
    } else {
      const entry = { key, value, line: lineNo };
      byKey.set(key, entry);
      order.push(key);
    }
  }

  return { entries: order.map((k) => byKey.get(k)!), issues };
}

export type DiffKind = "add" | "overwrite";

export interface EnvDiffItem {
  key: string;
  kind: DiffKind;
  /** Browser-exposed prefix (NEXT_PUBLIC_ ...): the value ends up in the public JS bundle. */
  publicPrefix: boolean;
}

export interface EnvDiff {
  items: EnvDiffItem[];
  added: number;
  overwritten: number;
  /** More changes than one `set_env` operation accepts. */
  overLimit: boolean;
}

/**
 * Diff of an import against the keys that already exist. Values are never compared (the browser only knows
 * key names), so an existing key is reported as «overwrite», not as «changed». Keys absent from the import
 * are left untouched.
 */
export function buildEnvDiff(existingKeys: readonly string[], entries: readonly Pick<EnvEntry, "key">[]): EnvDiff {
  const existing = new Set(existingKeys);
  const items: EnvDiffItem[] = entries.map((e) => ({
    key: e.key,
    kind: existing.has(e.key) ? "overwrite" : "add",
    publicPrefix: isPublicEnvKey(e.key),
  }));
  return {
    items,
    added: items.filter((i) => i.kind === "add").length,
    overwritten: items.filter((i) => i.kind === "overwrite").length,
    overLimit: items.length > MAX_ENV_CHANGES,
  };
}

export interface SetEnvRequest {
  params: Extract<ActionParams, { type: "set_env" }>;
  /** Typed values, keyed by env key; sent once to /api/ops and dropped. */
  userValues: Record<string, string>;
}

/** `set_env` params carry only keys + `valueSource:'user'`; the values travel separately in `userValues`. */
export function buildSetEnvRequest(app: string, entries: ReadonlyArray<Pick<EnvEntry, "key" | "value">>): SetEnvRequest {
  const userValues: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const e of entries) userValues[e.key] = e.value;
  return {
    params: {
      type: "set_env",
      app,
      changes: entries.map((e) => ({ op: "set" as const, key: e.key, valueSource: "user" as const })),
    },
    userValues: { ...userValues },
  };
}
