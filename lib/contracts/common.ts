import { z } from "zod";

/**
 * Shared primitives for every contract. This module is isomorphic (no Node APIs):
 * it is imported by client components as well as by server routes.
 */

/** Marker that replaces any redacted value (see lib/security/redact.ts). */
export const REDACTED_MARKER = "«redacted»";

/**
 * Document ids. They double as file names in the JSON store, so this charset is
 * the path-safety boundary: no dots, slashes, NUL or unicode can ever pass.
 */
export const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const SafeIdSchema = z.string().regex(SAFE_ID_RE);

/** Hashed account id as produced by the session layer (opaque, filesystem-safe). */
export const AccountIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** Machine-readable codes: i18n keys, rule names, check names, audit actions. */
export const CODE_RE = /^[a-z][a-z0-9_.:-]{0,79}$/;
export const CodeSchema = z.string().regex(CODE_RE);

export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Keys that must never be accepted as dynamic record keys (prototype pollution). */
export const FORBIDDEN_RECORD_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** Builds a record-key schema from an anchored regex, excluding prototype-sensitive names. */
export function recordKey(re: RegExp) {
  return z
    .string()
    .regex(re)
    .refine((k) => !FORBIDDEN_RECORD_KEYS.has(k), { message: "reserved key" });
}

/** Keys of small free-form records (observation params, snapshots). */
export const SafeKeySchema = recordKey(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);

/** String schema whose (possibly expensive) regex only runs on inputs within `max`. */
export function boundedString(max: number, re: RegExp, message = "invalid format") {
  return z
    .string()
    .max(max)
    .refine((s) => s.length <= max && re.test(s), { message });
}

/* ------------------------------------------------------------------ names */

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Liara app names (also the subdomain): lowercase DNS label. */
export const AppNameSchema = z.string().regex(DNS_LABEL);
/** Liara database hostnames are user-chosen DNS labels too. */
export const DbNameSchema = z.string().regex(DNS_LABEL);
export const DiskNameSchema = z.string().regex(DNS_LABEL);
export const NetworkNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/);
export const ProjectNameSchema = NetworkNameSchema;

/** Lowercase FQDN (IDNs must be given in punycode). No trailing dot, no wildcard. */
export const DomainNameSchema = boundedString(
  253,
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  "invalid domain name",
);

export const TARGET_KINDS = ["app", "db", "network", "domain", "project", "disk"] as const;
export const TargetKindSchema = z.enum(TARGET_KINDS);
export type TargetKind = z.infer<typeof TargetKindSchema>;

/** A resource an action targets; the name is validated per kind (also prevents path injection). */
export const TargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("app"), name: AppNameSchema }),
  z.strictObject({ kind: z.literal("db"), name: DbNameSchema }),
  z.strictObject({ kind: z.literal("network"), name: NetworkNameSchema }),
  z.strictObject({ kind: z.literal("domain"), name: DomainNameSchema }),
  z.strictObject({ kind: z.literal("project"), name: ProjectNameSchema }),
  z.strictObject({ kind: z.literal("disk"), name: DiskNameSchema }),
]);
export type Target = z.infer<typeof TargetSchema>;

/* ---------------------------------------------------------- liara values */

export const PLATFORMS = [
  "node",
  "laravel",
  "php",
  "python",
  "django",
  "flask",
  "dotnet",
  "react",
  "angular",
  "vue",
  "static",
  "docker",
  "next",
  "go",
] as const;
export const PlatformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof PlatformSchema>;

export const DB_ENGINES = [
  "mysql",
  "mariadb",
  "postgres",
  "mssql",
  "mongodb",
  "redis",
  "elasticsearch",
  "rabbitmq",
  "clickhouse",
] as const;
export const DbEngineSchema = z.enum(DB_ENGINES);
export type DbEngine = z.infer<typeof DbEngineSchema>;

export const PlanIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
export const DbVersionSchema = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/);
export const PortSchema = z.number().int().min(1).max(65535);

/** Docker image reference: [registry[:port]/]repo[/repo...][:tag][@sha256:digest]. */
export const DockerImageSchema = boundedString(
  255,
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,10}(?::[0-9]{1,5})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/,
  "invalid image reference",
);

/* ------------------------------------------------------------------- cost */

/** Liara bills hourly; the UI's monthly figure is hourly x 720. */
export const HOURS_PER_MONTH = 720;
const TomanSchema = z.number().min(0).max(1e12);

export const CostSchema = z
  .strictObject({ perHourToman: TomanSchema, perMonthToman: TomanSchema })
  .refine(
    // Tolerates rounding of the hourly price to whole toman.
    (c) => Math.abs(c.perMonthToman - c.perHourToman * HOURS_PER_MONTH) <= HOURS_PER_MONTH,
    { message: "perMonthToman must equal perHourToman x 720" },
  );
export type Cost = z.infer<typeof CostSchema>;

export function costFromHourly(perHourToman: number): Cost {
  return { perHourToman, perMonthToman: Math.round(perHourToman * HOURS_PER_MONTH) };
}
