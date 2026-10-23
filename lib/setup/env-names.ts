// Env-var NAME extraction. Values are never returned, stored or logged:
//  - sanitizeEnvText() runs inside the archive reader, so the retained copy of any .env* file contains names only
//    (plus a coarse "engine hint" derived from a URL scheme / DB_CONNECTION word, never the rest of the value);
//  - the detector can therefore not leak a value even by accident.
import type { DbEngine } from "@/lib/contracts";

export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_NAMES = 200;

const SECRET_RE =
  /(SECRET|PASSWORD|PASSWD|PASSPHRASE|TOKEN|PRIVATE|API_?KEY|ACCESS_?KEY|AUTH_?KEY|CREDENTIAL|SALT|DSN|CLIENT_SECRET|ENCRYPTION|SIGNING)|(^|_)KEY$|^(?:DATABASE|DB|REDIS|MONGO[A-Z]*|MYSQL|POSTGRES(?:QL)?|AMQP|BROKER)_?(?:URL|URI)$/i;

export function looksSecret(name: string): boolean {
  return SECRET_RE.test(name);
}

/** Names that carry no user decision and are provided by the platform or by us. */
export const PLATFORM_ENV_NAMES: ReadonlySet<string> = new Set(["PORT", "NODE_ENV", "HOST", "HOSTNAME", "PWD", "PATH", "HOME", "TZ", "LANG", "CI"]);

const ENGINE_BY_WORD: Array<[RegExp, DbEngine]> = [
  [/^(?:postgres(?:ql)?|pgsql)$/i, "postgres"],
  [/^mysql$/i, "mysql"],
  [/^mariadb$/i, "mariadb"],
  [/^(?:sqlsrv|mssql|sqlserver)$/i, "mssql"],
  [/^mongo(?:db)?$/i, "mongodb"],
  [/^redis$/i, "redis"],
];

const URL_SCHEME_RE = /^["']?\s*(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|sqlserver|mssql|amqps?):\/\//i;

function engineFromScheme(scheme: string): DbEngine | undefined {
  const s = scheme.toLowerCase();
  if (s.startsWith("postgres")) return "postgres";
  if (s === "mysql") return "mysql";
  if (s === "mariadb") return "mariadb";
  if (s.startsWith("mongodb")) return "mongodb";
  if (s.startsWith("redis")) return "redis";
  if (s === "sqlserver" || s === "mssql") return "mssql";
  if (s.startsWith("amqp")) return undefined; // rabbitmq url: engine not auto-suggested from a scheme
  return undefined;
}

const ENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]{0,63})\s*=(.*)$/;
const COMMENTED_LINE_RE = /^\s*#\s*([A-Z][A-Z0-9_]{2,63})\s*=/;
export const ENV_HINT_PREFIX = "#hint:engine=";

/**
 * Reduces the text of a dotenv-style file to "NAME" lines plus optional "#hint:engine=<engine>" lines.
 * The values never leave this function.
 */
export function sanitizeEnvText(text: string): string {
  const names = new Set<string>();
  const hints = new Set<string>();
  for (const line of text.slice(0, 256 * 1024).split(/\r?\n/)) {
    const m = ENV_LINE_RE.exec(line);
    if (m) {
      const name = m[1];
      names.add(name);
      const value = m[2].trim();
      if (name === "DB_CONNECTION" || name === "DB_DRIVER") {
        const word = value.replace(/["']/g, "").trim();
        const hit = ENGINE_BY_WORD.find(([re]) => re.test(word));
        if (hit) hints.add(hit[1]);
      } else if (/(?:^|_)(?:URL|URI|DSN)$/.test(name)) {
        const s = URL_SCHEME_RE.exec(value);
        const engine = s ? engineFromScheme(s[1]) : undefined;
        if (engine) hints.add(engine);
      }
    } else {
      const c = COMMENTED_LINE_RE.exec(line);
      if (c) names.add(c[1]);
    }
    if (names.size >= MAX_NAMES) break;
  }
  return [...names, ...[...hints].map((h) => ENV_HINT_PREFIX + h)].join("\n");
}

export interface EnvParse {
  names: string[];
  engineHints: DbEngine[];
}

/** Parses the output of sanitizeEnvText (or any text; hints only exist in sanitized text). */
export function parseSanitizedEnv(text: string): EnvParse {
  const names: string[] = [];
  const engineHints: DbEngine[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(ENV_HINT_PREFIX)) {
      const e = line.slice(ENV_HINT_PREFIX.length) as DbEngine;
      if (["postgres", "mysql", "mariadb", "mssql", "mongodb", "redis"].includes(e)) engineHints.push(e);
    } else if (ENV_NAME_RE.test(line)) names.push(line);
  }
  return { names, engineHints };
}

/** `process.env.X`, `process.env["X"]`, `os.environ["X"]`, `os.getenv("X")`, `env('X')`, `getenv('X')`, `Environment.GetEnvironmentVariable("X")`, `os.Getenv("X")`. */
const CODE_ENV_RES: RegExp[] = [
  /process\.env\.([A-Z][A-Z0-9_]{2,63})\b/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]{2,63})['"]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]{2,63})\b/g,
  /os\.environ(?:\.get)?[\[(]\s*['"]([A-Z][A-Z0-9_]{2,63})['"]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{2,63})['"]/g,
  /\benv\(\s*['"]([A-Z][A-Z0-9_]{2,63})['"]/g,
  /\bgetenv\(\s*['"]([A-Z][A-Z0-9_]{2,63})['"]/g,
  /GetEnvironmentVariable\(\s*"([A-Z][A-Z0-9_]{2,63})"/g,
  /os\.Getenv\(\s*"([A-Z][A-Z0-9_]{2,63})"/g,
];

export function envNamesFromCode(text: string): string[] {
  const out = new Set<string>();
  for (const re of CODE_ENV_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text.slice(0, 512 * 1024))) !== null) {
      out.add(m[1]);
      if (out.size >= MAX_NAMES) return [...out];
    }
  }
  return [...out];
}

/** README: names inside code fences written as NAME=..., and backticked UPPER_CASE names in an environment section. */
export function envNamesFromReadme(text: string): string[] {
  const out = new Set<string>();
  const body = text.slice(0, 256 * 1024);
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(body)) !== null) {
    for (const line of m[1].split(/\r?\n/)) {
      const l = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,63})=/.exec(line);
      if (l) out.add(l[1]);
    }
  }
  let inEnvSection = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^#{1,4}\s/.test(line)) inEnvSection = /env|environment|configuration|config|متغیر|پیکربندی/i.test(line);
    else if (inEnvSection) {
      const tick = /`([A-Z][A-Z0-9_]{2,63})`/g;
      let t: RegExpExecArray | null;
      while ((t = tick.exec(line)) !== null) out.add(t[1]);
    }
    if (out.size >= MAX_NAMES) break;
  }
  return [...out];
}

export function uniqueNames(...lists: Array<readonly string[]>): string[] {
  const seen = new Set<string>();
  for (const l of lists) for (const n of l) if (ENV_NAME_RE.test(n)) seen.add(n);
  return [...seen].slice(0, MAX_NAMES);
}
