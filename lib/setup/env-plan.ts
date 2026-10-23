// Env checklist + DB wiring keys. NAMES only: the plan can say where a value comes from (user / generated),
// it can never say what the value is.
import { WireMappingSchema, isPublicEnvKey, type DbEngine, type EnvKey, type SecretGenerator, type WireMapping } from "@/lib/contracts";
import { PLATFORM_ENV_NAMES, looksSecret } from "./env-names";

export type EnvValueSource = "user" | "generated";

export interface EnvChecklistItem {
  name: string;
  valueSource: EnvValueSource;
  generator?: SecretGenerator;
  secret: boolean;
  /** Key into setupFlow.envHelp, shown next to the field. */
  helpKey?: string;
  /** Placeholder text only (never sent anywhere). */
  placeholder?: string;
  /** Provided by the DB wiring step, so the user does not type it. */
  wired?: boolean;
}

/** Secrets the app uses only to sign/encrypt its own data: safe to generate randomly. */
const GENERATED_RE =
  /^(?:(?:SESSION|COOKIE|JWT|CSRF|AUTH|NEXTAUTH|APP|DJANGO|FLASK|SECRET|ENCRYPTION|SIGNING)_?)*(?:SECRET|SECRET_KEY|SECRET_KEY_BASE|SESSION_KEY|ENCRYPTION_KEY|SIGNING_KEY|JWT_KEY)$/;
const NEVER_GENERATE = new Set(["APP_KEY"]);
const THIRD_PARTY_RE = /(STRIPE|GITHUB|GOOGLE|FACEBOOK|TWITTER|AWS|AZURE|SENDGRID|MAILGUN|TWILIO|SLACK|OPENAI|ANTHROPIC|SMTP|MAIL|CLOUDINARY|SENTRY|ZARINPAL|PAYPING|KAVENEGAR|GHASEDAK|MELIPAYAMAK)/;

export function isGeneratable(name: string): boolean {
  return !NEVER_GENERATE.has(name) && !THIRD_PARTY_RE.test(name) && GENERATED_RE.test(name);
}

const PLACEHOLDERS: Record<string, string> = { DB_CONNECTION: "mysql", APP_ENV: "production", APP_DEBUG: "false", FLASK_ENV: "production" };
const HELP: Record<string, string> = { APP_KEY: "laravel_app_key", DJANGO_ALLOWED_HOSTS: "allowed_hosts", ALLOWED_HOSTS: "allowed_hosts" };

/** DB-related env names the wiring step fills in, per engine family, in priority order. */
const WIRE_CANDIDATES: Record<"sql" | "mongodb" | "redis", Record<keyof WireMapping, string[]>> = {
  sql: {
    host: ["DB_HOST", "DATABASE_HOST", "POSTGRES_HOST", "PGHOST", "MYSQL_HOST", "MYSQL_HOSTNAME", "SQL_HOST"],
    port: ["DB_PORT", "DATABASE_PORT", "POSTGRES_PORT", "PGPORT", "MYSQL_PORT"],
    user: ["DB_USERNAME", "DB_USER", "DATABASE_USER", "POSTGRES_USER", "PGUSER", "MYSQL_USER"],
    password: ["DB_PASSWORD", "DATABASE_PASSWORD", "POSTGRES_PASSWORD", "PGPASSWORD", "MYSQL_PASSWORD"],
    database: ["DB_DATABASE", "DB_NAME", "DATABASE_NAME", "POSTGRES_DB", "PGDATABASE", "MYSQL_DATABASE"],
    url: ["DATABASE_URL", "DB_URL", "POSTGRES_URL", "MYSQL_URL", "SQLALCHEMY_DATABASE_URI"],
  },
  mongodb: {
    host: ["MONGO_HOST", "MONGODB_HOST"],
    port: ["MONGO_PORT", "MONGODB_PORT"],
    user: ["MONGO_USER", "MONGODB_USER", "MONGO_USERNAME"],
    password: ["MONGO_PASSWORD", "MONGODB_PASSWORD"],
    database: ["MONGO_DB", "MONGODB_DB", "MONGO_DATABASE"],
    url: ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "MONGODB_URL", "DATABASE_URL"],
  },
  redis: {
    host: ["REDIS_HOST"],
    port: ["REDIS_PORT"],
    user: ["REDIS_USER", "REDIS_USERNAME"],
    password: ["REDIS_PASSWORD"],
    database: [],
    url: ["REDIS_URL", "REDIS_URI"],
  },
};
const DEFAULT_URL_KEY = { sql: "DATABASE_URL", mongodb: "MONGODB_URI", redis: "REDIS_URL" } as const;
const family = (e: DbEngine): "sql" | "mongodb" | "redis" | undefined =>
  e === "mongodb" ? "mongodb" : e === "redis" ? "redis" : e === "postgres" || e === "mysql" || e === "mariadb" || e === "mssql" ? "sql" : undefined;

export interface WireProposal {
  mapping: WireMapping;
  /** True when no matching name was found in the project and the default URL key was assumed. */
  assumed: boolean;
}

/** Which env keys should receive which DB field. Prefers keys the project already mentions; never public-prefixed. */
export function wireMappingFor(engine: DbEngine, names: readonly string[]): WireProposal | undefined {
  const fam = family(engine);
  if (!fam) return undefined;
  const known = new Set(names);
  const pick = (f: keyof WireMapping): EnvKey | undefined => WIRE_CANDIDATES[fam][f].find((n) => known.has(n) && !isPublicEnvKey(n));
  const parts: WireMapping = {};
  for (const f of ["host", "port", "user", "password", "database"] as const) {
    const k = pick(f);
    if (k) parts[f] = k;
  }
  const url = pick("url");
  const hasParts = Object.keys(parts).length > 0;
  // Component keys win when the project asks for them (Laravel DB_*); otherwise a single URL key.
  if (hasParts && !(url && !parts.host)) return { mapping: parts, assumed: false };
  if (url) return { mapping: { url }, assumed: false };
  return { mapping: { url: DEFAULT_URL_KEY[fam] }, assumed: true };
}

export function validateWireMapping(m: unknown): WireMapping | undefined {
  const r = WireMappingSchema.safeParse(m);
  return r.success ? r.data : undefined;
}

export function buildEnvChecklist(names: readonly string[], wiredKeys: readonly string[] = []): EnvChecklistItem[] {
  const wired = new Set(wiredKeys);
  const items: EnvChecklistItem[] = [];
  for (const name of names) {
    if (PLATFORM_ENV_NAMES.has(name)) continue;
    const gen = isGeneratable(name);
    items.push({
      name,
      valueSource: gen ? "generated" : "user",
      generator: gen ? "hex32" : undefined,
      secret: looksSecret(name),
      helpKey: HELP[name],
      placeholder: PLACEHOLDERS[name],
      wired: wired.has(name) || undefined,
    });
  }
  // What the user must type comes first.
  return items.sort((a, b) => Number(!!a.wired) - Number(!!b.wired) || Number(a.valueSource === "generated") - Number(b.valueSource === "generated") || a.name.localeCompare(b.name));
}
