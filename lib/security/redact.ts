import { REDACTED_MARKER } from "../contracts/common";
import { cleanText, foldForMatch } from "./unicode";

/**
 * Redaction for everything that leaves the server boundary or gets persisted:
 * UI payloads, LLM context, audit log, incidents, observation excerpts.
 *
 * Design:
 *  - The input is first cleaned (NFKC, invisible/bidi characters removed) so
 *    zero-width or fullwidth tricks cannot split a secret past the patterns.
 *  - Patterns run on a 1:1 folded copy (homoglyphs and Persian digits mapped to
 *    ASCII); match offsets are applied to the cleaned text.
 *  - Over-redaction is accepted; leaks are not. Patterns are bounded to avoid
 *    catastrophic backtracking on hostile multi-megabyte log lines.
 *  - `knownSecrets` (env values, DB passwords) are scrubbed by exact match of a
 *    bounded set of transformed forms computed once per redactor: raw, JSON- and
 *    URL-escaped, upper/lower case, separators removed, hex (both cases) and
 *    base64 (standard + URL-safe, padded and not, and the alignment-independent
 *    core for each of the 3 byte offsets, so the secret is found inside a larger
 *    encoded blob). A secret split across two adjacent lines (wrapped output, or
 *    printed in two halves) is found by checking each line end against the next
 *    line. Matching uses a 3-character index, so cost does not grow per variant.
 */

export const REDACTED = REDACTED_MARKER;
export const KNOWN_SECRET_MIN_LENGTH = 6;
/** Longer inputs are cut (at a whitespace boundary) before redaction. */
export const REDACT_MAX_INPUT = 1_000_000;
const TRUNCATED = "…«truncated»";
const MAX_DEPTH = 32;

export interface RedactOptions {
  /** Exact values to scrub anywhere (env values, DB passwords); shorter than 6 chars are ignored. */
  knownSecrets?: readonly string[];
}

type Range = [number, number];

interface Rule {
  name: string;
  re: RegExp;
  /** Named group holding the secret; the whole match otherwise. */
  group?: string;
  /** Strip surrounding quotes from the secret range. */
  trimQuotes?: boolean;
  accept?: (m: RegExpExecArray) => boolean;
}

const re = (source: string, flags: string) => new RegExp(source, flags);

/* ---------------------------------------------------------------- keys */

// Secret-ish identifier fragment used inside key names (case-insensitive).
const KW = String.raw`(?:pass(?:words?|wds?|phrases?)?(?![a-z])|passwort(?![a-z])|kennwort(?![a-z])|pwd(?![a-z])|secrets?|tokens?|api[_ -]?keys?|access[_ -]?keys?|account[_ -]?keys?|private[_ -]?keys?|signing[_ -]?keys?|encryption[_ -]?keys?|master[_ -]?keys?|credentials?|session[_ -]?(?:ids?|keys?)|cookies?|[_.-]keys?(?![a-z])|dsn(?![a-z])|auth(?![a-z])|authorization|(?<![a-z])pin(?:code)?(?![a-z])|(?<![a-z])otp(?![a-z])|(?<![a-z])cvv(?![a-z]))`;
const KEYCHARS = String.raw`[A-Za-z0-9_.-]`;
const KEY = String.raw`(?<![A-Za-z0-9_.-])${KEYCHARS}{0,40}?${KW}${KEYCHARS}{0,40}`;
const VALUE = String.raw`(?<secret>"(?:[^"\\\r\n]|\\.){0,4096}"|'(?:[^'\\\r\n]|\\.){0,4096}'|[^\s"'<>]{1,4096})`;

// Values that carry diagnostic meaning and cannot be secrets ("token: undefined").
const NON_SECRET_VALUES = new Set([
  "undefined", "null", "none", "nil", "<nil>", "(null)", "true", "false", "missing", "unset",
  "empty", "not", "is", "[redacted]", "[filtered]", "***", "****", "*****", "******", "********",
]);

function stripQuotes(v: string): string {
  return v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0] ? v.slice(1, -1) : v;
}

function acceptAssignment(m: RegExpExecArray): boolean {
  const raw = stripQuotes(m.groups?.secret ?? "");
  if (raw === "" || raw === REDACTED) return false;
  return !NON_SECRET_VALUES.has(raw.replace(/[,;]+$/, "").toLowerCase());
}

const hasDigit = (s: string) => /[0-9]/.test(s);
const hasUpper = (s: string) => /[A-Z]/.test(s);
const hasLower = (s: string) => /[a-z]/.test(s);

/** Scheme credential: must look random, not like a word ("token validation"). */
function acceptCredential(m: RegExpExecArray): boolean {
  const v = m.groups?.secret ?? "";
  return hasDigit(v) || /[-._~+/=]/.test(v) || (hasUpper(v) && hasLower(v));
}

function acceptHighEntropy(m: RegExpExecArray): boolean {
  const v = m[0];
  if (hasUpper(v) && hasLower(v) && hasDigit(v)) return true;
  // Long single-case+digit runs, but keep hex ids readable: hashes, digests and
  // prefixed ids such as `idk_<hex>` / `req-<hex>` (an optional short prefix is ignored).
  const body = v.replace(/^[a-z][a-z0-9]{0,11}[_-]/i, "").replace(/[=_-]/g, "");
  return v.length >= 40 && hasDigit(v) && /[A-Za-z]/.test(v) && !/^[0-9a-f]+$/i.test(body);
}

const DB_SCHEMES = String.raw`(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|clickhouse|elasticsearch|jdbc:[a-z0-9]+)`;

const RULES: readonly Rule[] = [
  {
    name: "private_key_block",
    re: re(
      String.raw`-----BEGIN[ A-Z0-9]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[ A-Z0-9]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)`,
      "g",
    ),
  },
  { name: "jwt", re: re(String.raw`(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){2,4}`, "g") },
  {
    name: "vendor_token",
    re: re(
      String.raw`(?<![A-Za-z0-9_-])(?:(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|APKA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Za-z0-9])|gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255}|glpat-[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9+/=]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|GOCSPX-[A-Za-z0-9_-]{20,}|ya29\.[0-9A-Za-z_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|key-[0-9a-zA-Z]{32}|npm_[A-Za-z0-9]{36}|pypi-[A-Za-z0-9_-]{50,}|hf_[A-Za-z0-9]{30,}|do[opr]_v1_[a-f0-9]{64}|shp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}|dckr_pat_[A-Za-z0-9_-]{20,})`,
      "g",
    ),
  },
  { name: "telegram_bot_token", re: re(String.raw`(?<![0-9])[0-9]{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])`, "g") },
  { name: "slack_webhook", re: re(String.raw`hooks\.slack\.com/services/(?<secret>[A-Za-z0-9_/-]{10,})`, "gdi"), group: "secret" },
  {
    // RFC userinfo: the password cannot contain '/', '?' or '#'; '@' is tolerated (last '@' wins).
    name: "url_credentials",
    re: re(
      String.raw`(?<![A-Za-z0-9+.-])[a-z][a-z0-9+.-]{0,30}://[^\s:@/?#"'<>]{0,256}:(?<secret>[^\s"'<>/?#]{1,512})@(?=[A-Za-z0-9\[%_-])`,
      "gdi",
    ),
    group: "secret",
  },
  {
    // Connection strings are often written with unencoded special characters in the password.
    name: "db_url_credentials",
    re: re(
      String.raw`(?<![A-Za-z0-9+.-])${DB_SCHEMES}://[^\s:@/?#"'<>]{0,256}:(?<secret>[^\s"'<>]{1,512})@(?=[A-Za-z0-9\[%_-])`,
      "gdi",
    ),
    group: "secret",
  },
  {
    name: "url_token_userinfo",
    re: re(
      String.raw`(?<![A-Za-z0-9+.-])[a-z][a-z0-9+.-]{0,30}://(?<secret>[A-Za-z0-9._~%!$&'()*+,;=-]{16,256})@(?=[A-Za-z0-9\[])`,
      "gdi",
    ),
    group: "secret",
  },
  {
    name: "auth_header",
    re: re(
      String.raw`(?<![A-Za-z0-9_-])(?:proxy-authorization|authorization|x-api-key|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|x-amz-security-token|api-key|set-cookie|cookie)["']?[ \t]{0,8}[:=][ \t]{0,8}["']?(?<secret>[^\r\n"']{1,4096})`,
      "gdi",
    ),
    group: "secret",
  },
  {
    name: "auth_scheme",
    re: re(String.raw`(?<![A-Za-z0-9_-])(?:bearer|token|basic|digest)[ \t]+(?<secret>[A-Za-z0-9\-._~+/]{8,}={0,2})`, "gdi"),
    group: "secret",
    accept: acceptCredential,
  },
  {
    name: "query_secret",
    re: re(
      String.raw`[?&;](?:sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|access_token|refresh_token|id_token|token|code|key|apikey|api_key|auth|password|passwd|pwd|secret|client_secret)=(?<secret>[^&#\s"'<>]{1,4096})`,
      "gdi",
    ),
    group: "secret",
  },
  {
    name: "assignment",
    re: re(String.raw`${KEY}["']?\s{0,32}(?:=>|:=|=|:)\s{0,32}${VALUE}`, "gdi"),
    group: "secret",
    trimQuotes: true,
    accept: acceptAssignment,
  },
  {
    // CLI flags with a space-separated value: `--password hunter2`, `-storepass changeit`.
    name: "cli_flag_value",
    re: re(
      String.raw`(?<![A-Za-z0-9_-])--?${KEYCHARS}{0,20}?${KW}[A-Za-z0-9_-]{0,20}[ \t]+(?<secret>"(?:[^"\\\r\n]|\\.){0,4096}"|'(?:[^'\\\r\n]|\\.){0,4096}'|[^\s"'-][^\s"']{0,4095})`,
      "gdi",
    ),
    group: "secret",
    trimQuotes: true,
    accept: acceptAssignment,
  },
  {
    name: "xml_secret",
    re: re(String.raw`<(?:${KEYCHARS}|:){0,40}?${KW}(?:${KEYCHARS}|:){0,40}[ \t]*>(?<secret>[^<]{1,4096})<`, "gdi"),
    group: "secret",
  },
  {
    // "api key 3f2a9b..." / "token is a8F3..." (no separator, long token after a secret-ish word)
    name: "keyword_then_token",
    re: re(
      String.raw`${KEY}["']?[ \t]{1,4}(?:is[ \t]+|of[ \t]+)?(?<secret>[A-Za-z0-9+/_=.-]{8,4096})`,
      "gdi",
    ),
    group: "secret",
    accept: (m) => hasDigit(m.groups?.secret ?? "") && /[A-Za-z]/.test(m.groups?.secret ?? ""),
  },
  {
    // {"key":"DB_PASSWORD","value":"..."} printed into a log line.
    name: "env_pair_text",
    re: re(
      String.raw`"(?:key|name)"\s{0,8}:\s{0,8}"(?<k>[^"\\]{1,128})"\s{0,8},\s{0,8}"value"\s{0,8}:\s{0,8}(?<secret>"(?:[^"\\]|\\.){0,4096}")`,
      "gdi",
    ),
    group: "secret",
    trimQuotes: true,
    accept: (m) => isSecretKey(m.groups?.k ?? ""),
  },
  {
    name: "env_pair_text_reversed",
    re: re(
      String.raw`"value"\s{0,8}:\s{0,8}(?<secret>"(?:[^"\\]|\\.){0,4096}")\s{0,8},\s{0,8}"(?:key|name)"\s{0,8}:\s{0,8}"(?<k>[^"\\]{1,128})"`,
      "gdi",
    ),
    group: "secret",
    trimQuotes: true,
    accept: (m) => isSecretKey(m.groups?.k ?? ""),
  },
  {
    // `PASSWORD<TAB>value`: tab-separated key/value tables (env dumps, psql output). Plain spaces are prose.
    name: "tab_assignment",
    re: re(String.raw`${KEY}["']?\t{1,8}${VALUE}`, "gdi"),
    group: "secret",
    trimQuotes: true,
    accept: acceptAssignment,
  },
  {
    // SQL: ALTER USER x WITH PASSWORD 'p', CREATE USER x IDENTIFIED BY 'p', ENCRYPTED PASSWORD "p".
    name: "sql_password_literal",
    re: re(String.raw`(?<![A-Za-z0-9_])(?:password|identified[ \t]+by)[ \t]+(?<secret>'(?:[^'\\\r\n]|\\.|''){1,4096}'|"(?:[^"\\\r\n]|\\.){1,4096}")`, "gdi"),
    group: "secret",
    trimQuotes: true,
  },
  {
    // YAML block scalar under a secret-ish key: `password: |` followed by indented lines.
    name: "yaml_block_secret",
    re: re(
      String.raw`${KEY}["']?[ \t]{0,8}:[ \t]{0,8}[|>][-+0-9]{0,3}[ \t]*(?:#[^\r\n]{0,200})?\r?\n(?<secret>(?:[ \t]+[^\r\n]{0,4096}(?:\r?\n|$)){1,200})`,
      "gdi",
    ),
    group: "secret",
  },
  {
    // YAML plain scalar continued on the next, indented line: `password:\n  value`.
    name: "yaml_next_line_secret",
    re: re(String.raw`${KEY}["']?[ \t]{0,8}:[ \t]*\r?\n[ \t]+(?<secret>[^\s#][^\r\n]{0,4096})`, "gdi"),
    group: "secret",
  },
  {
    // `user:pass@host[:port]` without a scheme (connection strings in configs and logs).
    name: "bare_userinfo",
    re: re(
      String.raw`(?<![A-Za-z0-9._%+:/@-])[A-Za-z0-9._%+-]{1,64}:(?<secret>[^\s:@/"'<>]{1,256})@(?=(?:[A-Za-z0-9-]{1,63}\.){0,8}[A-Za-z0-9-]{1,63}(?::[0-9]{1,5})?(?:[\s/,;)"'\]]|$))`,
      "gd",
    ),
    group: "secret",
  },
  {
    // Persian key names, written as escapes (detection data, not UI copy): رمز / رمز عبور, گذرواژه, کلمه عبور /
    // کلمه‌ی عبور, پسورد, توکن, کلید مخفی / کلید خصوصی / کلید api - e.g. «رمز عبور: ...», «توکن=...».
    name: "persian_assignment",
    re: re(
      String.raw`(?:\u0631\u0645\u0632(?:[ \u200c]?\u0639\u0628\u0648\u0631)?|\u06af\u0630\u0631\u0648\u0627\u0698\u0647|\u06a9\u0644\u0645\u0647[ \u200c]?(?:\u06cc[ \u200c])?\u0639\u0628\u0648\u0631|\u067e\u0633\u0648\u0631\u062f|\u062a\u0648\u06a9\u0646|\u06a9\u0644\u06cc\u062f[ \u200c](?:\u0645\u062e\u0641\u06cc|\u062e\u0635\u0648\u0635\u06cc|api))[ \t]{0,8}[:=\uff1a][ \t]{0,8}${VALUE}`,
      "gdi",
    ),
    group: "secret",
    trimQuotes: true,
    accept: acceptAssignment,
  },
  {
    // argv printed as JSON: ["--password", "x"], ["-p", "x"], ["--token","x"].
    name: "argv_json_secret",
    re: re(
      String.raw`"(?:-p|--?${KEYCHARS}{0,20}?${KW}[A-Za-z0-9_-]{0,20})"\s{0,8},\s{0,8}(?<secret>"(?:[^"\\\r\n]|\\.){1,4096}")`,
      "gdi",
    ),
    group: "secret",
    trimQuotes: true,
    accept: (m) => !/^"-/.test(m.groups?.secret ?? ""),
  },
  {
    // mysql-family clients take the password after `-p` (also space-separated in practice).
    name: "mysql_p_flag",
    re: re(
      String.raw`\b(?:mysql|mysqldump|mysqladmin|mysqlimport|mysqlshow|mysqlcheck|mariadb(?:-dump|-admin)?)\b[^\r\n]{0,200}?(?<![A-Za-z0-9_-])-p[ \t]+(?<secret>[^\s"'-][^\s"']{0,4095})`,
      "gdi",
    ),
    group: "secret",
  },
  {
    name: "high_entropy",
    re: re(String.raw`(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_=-])`, "g"),
    accept: acceptHighEntropy,
  },
];

/** argv flags whose NEXT element is a secret (redactDeep over arrays such as `args: ["--password", "x"]`). */
const ARGV_SECRET_FLAG = re(String.raw`^(?:-p|--?${KEYCHARS}{0,20}?${KW}[A-Za-z0-9_-]{0,20})$`, "i");

/* ------------------------------------------------------------ key names */

const SECRET_KEY_SUBSTRINGS = ["password", "passwd", "secret", "token", "apikey", "privatekey", "credential", "accesskey"];
const SECRET_KEY_TOKENS = new Set([
  "pass", "pwd", "passphrase", "auth", "authorization", "cookie", "cookies", "jwt", "bearer", "salt",
  "dsn", "signature", "otp", "pin", "cvv", "sid", "sessionid", "sessid",
]);
const SECRET_KEY_BIGRAMS = new Set([
  "api key", "access key", "private key", "signing key", "encryption key", "master key", "account key",
  "session id", "session key", "license key", "client key", "service key",
]);
// "<x>Key" names that are not secrets.
const NON_SECRET_KEY_QUALIFIERS = new Set([
  "primary", "foreign", "sort", "partition", "cache", "idempotency", "routing", "i18n", "translation",
  "public", "object", "query", "react", "storage", "row", "hash", "group", "lookup", "dedup", "dedupe",
  "message", "map", "unique", "composite", "natural", "surrogate", "shard", "index", "cursor", "order",
  "sorting", "join", "env", "the", "a",
]);
const ENV_CONTAINER_KEYS = new Set([
  "env", "envs", "environment", "environments", "environmentvariables", "envvars", "envvariables",
  "variables", "vars",
]);

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when an object key / env key name denotes a secret (DB_PASSWORD, apiKey, x-auth-token...). */
export function isSecretKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > 256) return false;
  const folded = foldForMatch(cleanText(key));
  const flat = folded.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SECRET_KEY_SUBSTRINGS.some((s) => flat.includes(s))) return true;
  const tokens = keyTokens(folded);
  if (tokens.some((t) => SECRET_KEY_TOKENS.has(t))) return true;
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (SECRET_KEY_BIGRAMS.has(`${tokens[i]} ${tokens[i + 1]}`)) return true;
  }
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && (last === "key" || last === "keys")) {
    return !NON_SECRET_KEY_QUALIFIERS.has(tokens[tokens.length - 2]);
  }
  return false;
}

function isEnvContainerKey(key: string): boolean {
  return ENV_CONTAINER_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/* ------------------------------------------------------------- engine */

interface Prepared {
  /** Folded known-secret variants, longest first. */
  secrets: readonly string[];
  /** First three characters -> variants starting with them (longest first). */
  grams: ReadonlyMap<string, readonly string[]>;
  /** Three characters ending a split prefix -> [variant, prefix length]: secrets split across two lines. */
  splits: ReadonlyMap<string, ReadonlyArray<readonly [string, number]>>;
}
const EMPTY_PREPARED: Prepared = { secrets: [], grams: new Map(), splits: new Map() };

/** Bounds that keep `prepare` and matching cheap whatever the caller passes. */
const MAX_KNOWN_SECRETS = 500;
const MAX_VARIANTS = 12_000;
/** Encoded (hex/base64) forms are computed for secrets up to this many UTF-8 bytes. */
const MAX_ENCODED_SECRET_BYTES = 512;
/** Split-across-lines detection: only variants this long, both halves at least 3 characters. */
const MIN_SPLIT_VARIANT = 8;
const MIN_SPLIT_PART = 3;

const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Plain-JS base64 (also runs in the browser bundle): standard alphabet, '=' padded. */
function base64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_STD[n >> 18] + B64_STD[(n >> 12) & 63] + B64_STD[(n >> 6) & 63] + B64_STD[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64_STD[n >> 18] + B64_STD[(n >> 12) & 63] + (i + 1 < bytes.length ? B64_STD[(n >> 6) & 63] : "=") + "=";
  }
  return out;
}
const urlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_");

/** The bounded set of transformed forms a known secret is searched in. */
function variantsOf(secret: string): string[] {
  const out = new Set<string>([secret, JSON.stringify(secret).slice(1, -1), secret.toUpperCase(), secret.toLowerCase()]);
  try {
    const encoded = encodeURIComponent(secret);
    out.add(encoded).add(encoded.replace(/%20/g, "+"));
  } catch {
    // lone surrogate: no URL form
  }
  const bare = secret.replace(/[\s_.:/-]+/g, "");
  if (bare !== secret && bare.length >= KNOWN_SECRET_MIN_LENGTH) out.add(bare);
  const bytes = new TextEncoder().encode(secret);
  if (bytes.length <= MAX_ENCODED_SECRET_BYTES) {
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    out.add(hex).add(hex.toUpperCase());
    const full = base64(bytes);
    for (const f of [full, urlSafe(full)]) out.add(f).add(f.replace(/=+$/, ""));
    // The secret inside a larger blob starts at byte offset 0, 1 or 2 of a 3-byte group: keep only the
    // characters that depend on the secret's bytes alone.
    for (let a = 0; a < 3; a++) {
      const shifted = new Uint8Array(a + bytes.length);
      shifted.set(bytes, a);
      const core = base64(shifted).slice(Math.ceil((8 * a) / 6), Math.floor((8 * (a + bytes.length)) / 6));
      if (core.length >= KNOWN_SECRET_MIN_LENGTH) out.add(core).add(urlSafe(core));
    }
  }
  return [...out];
}

function prepare(knownSecrets: readonly string[] | undefined): Prepared {
  if (!knownSecrets || knownSecrets.length === 0) return EMPTY_PREPARED;
  const set = new Set<string>();
  let used = 0;
  for (const raw of knownSecrets) {
    if (typeof raw !== "string" || raw.length < KNOWN_SECRET_MIN_LENGTH) continue;
    if (++used > MAX_KNOWN_SECRETS) break;
    for (const variant of variantsOf(raw)) {
      const f = foldForMatch(cleanText(variant));
      if (f.length >= 4) set.add(f);
    }
    if (set.size >= MAX_VARIANTS) break;
  }
  const secrets = [...set].sort((a, b) => b.length - a.length);
  const grams = new Map<string, string[]>();
  const splits = new Map<string, Array<readonly [string, number]>>();
  for (const s of secrets) {
    const g = s.slice(0, 3);
    const list = grams.get(g);
    if (list) list.push(s);
    else grams.set(g, [s]);
    if (s.length < MIN_SPLIT_VARIANT) continue;
    for (let k = MIN_SPLIT_PART; k <= s.length - MIN_SPLIT_PART; k++) {
      const key = s.slice(k - 3, k);
      const entries = splits.get(key);
      if (entries) entries.push([s, k]);
      else splits.set(key, [[s, k]]);
    }
  }
  return { secrets, grams, splits };
}

/** Every occurrence of every known-secret variant (3-char index, longest variant first at each position). */
function knownSecretRanges(folded: string, prepared: Prepared, ranges: Range[]): void {
  if (prepared.secrets.length === 0) return;
  for (let i = 0; i + 4 <= folded.length; i++) {
    const candidates = prepared.grams.get(folded.slice(i, i + 3));
    if (!candidates) continue;
    for (const s of candidates) {
      if (folded.startsWith(s, i)) {
        ranges.push([i, i + s.length]);
        break;
      }
    }
  }
}

const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);

/**
 * A known secret split across the end of line `a` and line `b`: either wrapped (b starts with the rest) or printed
 * in two halves (the end of `a` is a token that starts the secret, the rest is a whole token somewhere in `b`).
 * Pushes one range per part, in the coordinates given by the offsets.
 */
function splitSecretRanges(a: string, aOff: number, b: string, bOff: number, prepared: Prepared, out: Range[]): void {
  if (prepared.splits.size === 0) return;
  let aEnd = a.length;
  while (aEnd > 0 && (a[aEnd - 1] === " " || a[aEnd - 1] === "\t" || a[aEnd - 1] === "\r")) aEnd--;
  if (aEnd < MIN_SPLIT_PART) return;
  const candidates = prepared.splits.get(a.slice(aEnd - 3, aEnd));
  if (!candidates) return;
  let bStart = 0;
  while (bStart < b.length && (b[bStart] === " " || b[bStart] === "\t")) bStart++;
  for (const [s, k] of candidates) {
    if (aEnd < k || !a.startsWith(s.slice(0, k), aEnd - k)) continue;
    const rest = s.slice(k);
    if (b.startsWith(rest, bStart)) {
      out.push([aOff + aEnd - k, aOff + aEnd], [bOff + bStart, bOff + bStart + rest.length]);
      continue;
    }
    if (isWordChar(a[aEnd - k - 1])) continue;
    for (let i = b.indexOf(rest); i !== -1; i = b.indexOf(rest, i + 1)) {
      if (!isWordChar(b[i - 1]) && !isWordChar(b[i + rest.length])) {
        out.push([aOff + aEnd - k, aOff + aEnd], [bOff + i, bOff + i + rest.length]);
        break;
      }
    }
  }
}

/** Split detection between every pair of adjacent lines of one multi-line string. */
function crossLineRanges(folded: string, prepared: Prepared, out: Range[]): void {
  if (prepared.splits.size === 0 || !folded.includes("\n")) return;
  let start = 0;
  let next = folded.indexOf("\n");
  while (next !== -1) {
    const after = folded.indexOf("\n", next + 1);
    const lineB = after === -1 ? folded.slice(next + 1) : folded.slice(next + 1, after);
    splitSecretRanges(folded.slice(start, next), start, lineB, next + 1, prepared, out);
    start = next + 1;
    next = after;
  }
}

function truncate(text: string): string {
  if (text.length <= REDACT_MAX_INPUT) return text;
  // Cut at whitespace so a secret is not split into an unrecognizable fragment.
  let cut = REDACT_MAX_INPUT;
  const ws = text.slice(0, REDACT_MAX_INPUT).search(/\s[^\s]*$/);
  if (ws > 0) cut = ws;
  return text.slice(0, cut) + TRUNCATED;
}

function collectRanges(folded: string, prepared: Prepared): Range[] {
  const ranges: Range[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(folded)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      if (rule.accept && !rule.accept(m)) continue;
      let start = m.index;
      let end = m.index + m[0].length;
      if (rule.group) {
        const idx = m.indices?.groups?.[rule.group];
        if (!idx) continue;
        [start, end] = idx;
      }
      if (rule.trimQuotes && end - start >= 2) {
        const q = folded[start];
        if ((q === '"' || q === "'") && folded[end - 1] === q) {
          start++;
          end--;
        }
      }
      if (end > start) ranges.push([start, end]);
    }
  }
  knownSecretRanges(folded, prepared, ranges);
  crossLineRanges(folded, prepared, ranges);
  return ranges;
}

function applyRanges(text: string, ranges: Range[]): string {
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = "";
  let pos = 0;
  let [curStart, curEnd] = ranges[0];
  for (let i = 1; i < ranges.length; i++) {
    const [s, e] = ranges[i];
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e;
    } else {
      out += text.slice(pos, curStart) + REDACTED;
      pos = curEnd;
      curStart = s;
      curEnd = e;
    }
  }
  return out + text.slice(pos, curStart) + REDACTED + text.slice(curEnd);
}

function run(input: unknown, prepared: Prepared): { text: string; found: boolean } {
  const text = truncate(cleanText(typeof input === "string" ? input : String(input)));
  const ranges = collectRanges(foldForMatch(text), prepared);
  return ranges.length === 0 ? { text, found: false } : { text: applyRanges(text, ranges), found: true };
}

/** `secret_key: |`, `secret_key: >-` or a bare `secret_key:` whose value continues on more-indented lines. */
const YAML_BLOCK_KEY = re(
  String.raw`^([ \t]*)(?:- )?["']?${KEYCHARS}{0,40}?${KW}${KEYCHARS}{0,40}["']?[ \t]{0,8}:[ \t]*(?:[|>][-+0-9]{0,3})?[ \t]*(?:#[^\r\n]{0,200})?$`,
  "i",
);

/**
 * Redacts a batch of lines (log lines, build output): each line like `run`, plus what only shows across lines -
 * a known secret split over two adjacent lines, and the indented continuation of a YAML secret block.
 * Lines map 1:1 to the output.
 */
function runLines(input: readonly unknown[], prepared: Prepared): string[] {
  const texts = input.map((v) => truncate(cleanText(typeof v === "string" ? v : String(v))));
  const folded = texts.map((t) => foldForMatch(t));
  const extra: Range[][] = texts.map(() => []);
  let blockIndent = -1;
  for (let i = 0; i < folded.length; i++) {
    const line = folded[i];
    if (i + 1 < folded.length) {
      const pair: Range[] = [];
      splitSecretRanges(line, 0, folded[i + 1], line.length + 1, prepared, pair);
      for (const [s, e] of pair) {
        if (s <= line.length) extra[i].push([s, e]);
        else extra[i + 1].push([s - line.length - 1, e - line.length - 1]);
      }
    }
    const indent = line.length - line.replace(/^[ \t]+/, "").length;
    if (blockIndent >= 0) {
      if (line.trim() === "") continue;
      if (indent > blockIndent) {
        extra[i].push([indent, line.length]);
        continue;
      }
      blockIndent = -1;
    }
    const m = YAML_BLOCK_KEY.exec(line);
    if (m) blockIndent = m[1].length;
  }
  return texts.map((t, i) => {
    const ranges = collectRanges(folded[i], prepared);
    for (const r of extra[i]) if (r[1] > r[0]) ranges.push(r);
    return ranges.length === 0 ? t : applyRanges(t, ranges);
  });
}

/* ---------------------------------------------------------------- API */

export function redactString(text: string, opts?: RedactOptions): string {
  return run(text, prepare(opts?.knownSecrets)).text;
}

/** Redacts lines as a batch (see `Redactor.lines`): also catches secrets split across adjacent lines. */
export function redactLines(lines: readonly string[], opts?: RedactOptions): string[] {
  return runLines(lines, prepare(opts?.knownSecrets));
}

/** True when `text` contains something `redactString` would redact. */
export function containsSecret(text: string, opts?: RedactOptions): boolean {
  return run(text, prepare(opts?.knownSecrets)).found;
}

interface WalkContext {
  /** Everything below is a secret value (under a secret-ish key). */
  force: boolean;
  /** Directly inside an env container (`envs`, `env`, `variables`...). */
  env: boolean;
}

function forcedLeaf(v: string | number | bigint): string {
  return typeof v === "string" && v === "" ? "" : REDACTED;
}

function pairKeyName(obj: Record<string, unknown>): string | undefined {
  for (const k of ["key", "name", "Key", "Name"]) {
    const v = obj[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function defineValue(out: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

function walk(v: unknown, prepared: Prepared, ctx: WalkContext, depth: number, stack: Set<object>): unknown {
  if (typeof v === "string") return ctx.force ? forcedLeaf(v) : run(v, prepared).text;
  if (typeof v === "number" || typeof v === "bigint") return ctx.force ? forcedLeaf(v) : v;
  if (v === null || v === undefined || typeof v === "boolean") return v;
  if (typeof v !== "object") return undefined; // functions, symbols
  if (depth >= MAX_DEPTH) return "«truncated»";
  if (stack.has(v)) return "«circular»";

  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof URL) return ctx.force ? REDACTED : run(v.href, prepared).text;
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return "«binary»";
  if (v instanceof RegExp) return run(String(v), prepared).text;

  stack.add(v);
  try {
    if (v instanceof Error) {
      const err: Record<string, unknown> = { name: v.name, message: walk(v.message, prepared, ctx, depth + 1, stack) };
      if (typeof v.stack === "string") err.stack = walk(v.stack, prepared, ctx, depth + 1, stack);
      const code = (v as { code?: unknown }).code;
      if (typeof code === "string" || typeof code === "number") err.code = code;
      return err;
    }
    if (Array.isArray(v) || v instanceof Set) {
      const items = [...v];
      // argv arrays: ["--password", "x"], ["-p", "x"], ["--token", "x"]: the element after the flag is the secret.
      return items.map((item, i) => {
        const prev = items[i - 1];
        const isFlagValue = typeof item === "string" && !item.startsWith("-") && typeof prev === "string" && ARGV_SECRET_FLAG.test(foldForMatch(cleanText(prev)));
        return walk(item, prepared, isFlagValue ? { ...ctx, force: true } : ctx, depth + 1, stack);
      });
    }
    const entries: Array<[string, unknown]> =
      v instanceof Map
        ? [...v.entries()].map(([k, val]) => [String(k), val])
        : Object.keys(v).map((k) => [k, (v as Record<string, unknown>)[k]]);
    const source = Object.fromEntries(entries) as Record<string, unknown>;
    const pairName = pairKeyName(source);
    const isPair = pairName !== undefined && ("value" in source || "Value" in source);
    const redactPairValue = isPair && (ctx.env || isSecretKey(pairName));

    const out: Record<string, unknown> = {};
    const used = new Set<string>();
    for (const [k, child] of entries) {
      const childCtx: WalkContext = {
        force:
          ctx.force ||
          isSecretKey(k) ||
          (redactPairValue && (k === "value" || k === "Value")) ||
          (ctx.env && !isPair), // record-form env: { NODE_ENV: "...", SECRET: "..." }
        env: isEnvContainerKey(k),
      };
      let key = run(k, prepared).text;
      for (let n = 2; used.has(key); n++) key = `${run(k, prepared).text}#${n}`;
      used.add(key);
      defineValue(out, key, walk(child, prepared, childCtx, depth + 1, stack));
    }
    return out;
  } finally {
    stack.delete(v);
  }
}

/**
 * Deep copy with secrets redacted: string values are pattern-redacted, values under
 * secret-ish keys are replaced, `{key,value}` pairs with secret-ish keys and every
 * value inside env containers are replaced, object keys are pattern-redacted.
 * Cycles become "«circular»", depth > 32 "«truncated»", binary "«binary»".
 */
export function redactDeep<T>(value: T, opts?: RedactOptions): T {
  return walk(value, prepare(opts?.knownSecrets), { force: false, env: false }, 0, new Set()) as T;
}

type EnvEntry = { key: string; value?: unknown };

/** Replaces every env value; empty stays empty (that fact is diagnostic, not secret). */
export function redactEnvValues(envs: readonly EnvEntry[]): Array<{ key: string; value: string }>;
export function redactEnvValues(envs: Readonly<Record<string, unknown>>): Record<string, string>;
export function redactEnvValues(
  envs: readonly EnvEntry[] | Readonly<Record<string, unknown>>,
): Array<{ key: string; value: string }> | Record<string, string> {
  const mask = (v: unknown) => (v === undefined || v === null || v === "" ? "" : REDACTED);
  if (Array.isArray(envs)) {
    return (envs as readonly EnvEntry[]).map((e) => ({ key: String(e.key), value: mask(e.value) }));
  }
  return Object.fromEntries(Object.keys(envs).map((k) => [k, mask((envs as Record<string, unknown>)[k])]));
}

// Standard values that cannot be secrets; scrubbing them everywhere would only destroy evidence.
const COMMON_NON_SECRET_ENV_VALUES = new Set([
  "production", "development", "staging", "testing", "localhost", "0.0.0.0", "127.0.0.1", "enabled",
  "disabled", "default",
]);

/**
 * Builds the `knownSecrets` allowlist: all env values (>= 6 chars, minus a few
 * standard non-secret words) plus explicit values such as DB passwords.
 */
export function selectKnownSecrets(input: {
  envs?: readonly EnvEntry[] | Readonly<Record<string, unknown>>;
  values?: readonly (string | null | undefined)[];
}): string[] {
  const out = new Set<string>();
  const envValues: unknown[] = Array.isArray(input.envs)
    ? (input.envs as readonly EnvEntry[]).map((e) => e.value)
    : input.envs
      ? Object.values(input.envs)
      : [];
  for (const v of envValues) {
    if (typeof v === "string" && v.length >= KNOWN_SECRET_MIN_LENGTH && !COMMON_NON_SECRET_ENV_VALUES.has(v.toLowerCase())) {
      out.add(v);
    }
  }
  for (const v of input.values ?? []) {
    if (typeof v === "string" && v.length >= KNOWN_SECRET_MIN_LENGTH) out.add(v);
  }
  return [...out];
}

export interface Redactor {
  string(text: string): string;
  /** A batch of lines, 1:1; also redacts secrets split across adjacent lines and YAML secret blocks. */
  lines(texts: readonly string[]): string[];
  deep<T>(value: T): T;
  contains(text: string): boolean;
}

/** Pre-computes known-secret variants once for many calls (e.g. a whole log batch). */
export function createRedactor(opts?: RedactOptions): Redactor {
  const prepared = prepare(opts?.knownSecrets);
  return {
    string: (text) => run(text, prepared).text,
    lines: (texts) => runLines(texts, prepared),
    deep: <T>(value: T) => walk(value, prepared, { force: false, env: false }, 0, new Set()) as T,
    contains: (text) => run(text, prepared).found,
  };
}
