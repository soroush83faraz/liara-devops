import { z } from "zod";
import { DbNameSchema, recordKey } from "./common";

/**
 * Environment-variable changes.
 *
 * SECURITY: a change never carries a value. Proposals are stored, streamed to the
 * UI and fed back to the LLM, so they hold only a *reference* to where the value
 * comes from (`valueSource`). Every schema here is strict, so an object carrying
 * a `value` field (or any unknown field) is rejected. The real value is resolved
 * server-side at execution time:
 *  - `user`:      typed by the user in the approval dialog, sent with the execute
 *                 request (see UserEnvValuesSchema), never persisted or echoed;
 *  - `generated`: random secret generated server-side;
 *  - `existing`:  copied server-side from an existing value (a DB field or another
 *                 env key of the same app) that the model never sees.
 * This also stops a prompt-injected model from pointing an app at an
 * attacker-controlled value: the model cannot express a literal value at all.
 */

export const EnvKeySchema = recordKey(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
export type EnvKey = z.infer<typeof EnvKeySchema>;

/**
 * Prefixes that frameworks / bundlers inline into the public client bundle (Next, Nx, Nuxt 2/3, Vite and
 * Vite-based tools, CRA, Vue CLI, Angular (@ngx-env), Gatsby, Expo, SvelteKit/Astro/Rsbuild `PUBLIC_`, Redwood,
 * Sanity Studio, Umi, Storybook, Parcel, Snowpack, WMR, Qwik, Bun, Tauri, electron-vite, Razzle).
 */
export const PUBLIC_ENV_PREFIXES = [
  "NEXT_PUBLIC_",
  "NX_PUBLIC_",
  "NUXT_PUBLIC_",
  "NUXT_ENV_",
  "VITE_",
  "REACT_APP_",
  "VUE_APP_",
  "NG_APP_",
  "GATSBY_",
  "EXPO_PUBLIC_",
  "PUBLIC_",
  "REDWOOD_ENV_",
  "SANITY_STUDIO_",
  "UMI_APP_",
  "STORYBOOK_",
  "PARCEL_",
  "SNOWPACK_PUBLIC_",
  "WMR_",
  "QWIK_PUBLIC_",
  "ASTRO_PUBLIC_",
  "BUN_PUBLIC_",
  "TAURI_",
  "RENDERER_VITE_",
  "PRELOAD_VITE_",
  "RAZZLE_",
] as const;

/** A key a known framework inlines into the browser bundle (drives the "public" warning in the UI). */
export function isPublicEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return PUBLIC_ENV_PREFIXES.some((p) => upper.startsWith(p));
}

/** Name segments announcing a client-side value: MY_PUBLIC_KEY, CLIENT_API_URL, DB_EXPOSED, ... */
const EXPOSURE_SEGMENT = /(?:^|_)(?:PUBLIC|EXPOSE|EXPOSED|CLIENT|BROWSER|FRONTEND)(?:_|$)/i;

/**
 * DENY rule for copying an EXISTING secret (another env value, a database credential) into a key. Deliberately
 * broader than the framework prefix list, which can never be complete: any known public prefix OR any key whose
 * name says it is meant for the client side. `existing` copies and wire mappings may not target such keys; the
 * contract enforces it and the executors re-check it (so the human /api/ops path and wire_db are covered too).
 * The user can still type a value for such a key explicitly.
 */
export function isExposedEnvKey(key: string): boolean {
  return isPublicEnvKey(key) || EXPOSURE_SEGMENT.test(key);
}

export const ENV_VALUE_SOURCES = ["generated", "user", "existing"] as const;
export type EnvValueSource = (typeof ENV_VALUE_SOURCES)[number];

/** Server-side secret generators: 32 random bytes, encoded. */
export const SECRET_GENERATORS = ["hex32", "base64url32"] as const;
export type SecretGenerator = (typeof SECRET_GENERATORS)[number];

export const DB_FIELDS = ["host", "port", "user", "password", "database", "url"] as const;
export type DbField = (typeof DB_FIELDS)[number];

export const EnvValueOriginSchema = z.discriminatedUnion("kind", [
  /** A field of a Liara database's detail (e.g. its password), resolved server-side. */
  z.strictObject({ kind: z.literal("db"), name: DbNameSchema, field: z.enum(DB_FIELDS) }),
  /** The current value of another env key of the same app (e.g. a typo'd key). */
  z.strictObject({ kind: z.literal("app_env"), key: EnvKeySchema }),
]);
export type EnvValueOrigin = z.infer<typeof EnvValueOriginSchema>;

const EnvSetFromUserSchema = z.strictObject({
  op: z.literal("set"),
  key: EnvKeySchema,
  valueSource: z.literal("user"),
});
const EnvSetGeneratedSchema = z.strictObject({
  op: z.literal("set"),
  key: EnvKeySchema,
  valueSource: z.literal("generated"),
  generator: z.enum(SECRET_GENERATORS),
});
const EnvSetFromExistingSchema = z
  .strictObject({
    op: z.literal("set"),
    key: EnvKeySchema,
    valueSource: z.literal("existing"),
    from: EnvValueOriginSchema,
  })
  .refine((c) => !isExposedEnvKey(c.key), { message: "cannot copy an existing value into a browser-exposed key" });

export const EnvSetChangeSchema = z.discriminatedUnion("valueSource", [
  EnvSetFromUserSchema,
  EnvSetGeneratedSchema,
  EnvSetFromExistingSchema,
]);
export const EnvUnsetChangeSchema = z.strictObject({ op: z.literal("unset"), key: EnvKeySchema });

export const EnvChangeSchema = z.discriminatedUnion("op", [EnvSetChangeSchema, EnvUnsetChangeSchema]);
export type EnvChange = z.infer<typeof EnvChangeSchema>;

export const MAX_ENV_CHANGES = 50;

export const EnvChangeListSchema = z
  .array(EnvChangeSchema)
  .min(1)
  .max(MAX_ENV_CHANGES)
  .refine((changes) => new Set(changes.map((c) => c.key)).size === changes.length, {
    message: "duplicate env key in changes",
  })
  .refine(
    (changes) =>
      changes.every((c) => !(c.op === "set" && c.valueSource === "existing" && c.from.kind === "app_env" && c.from.key === c.key)),
    { message: "an env key cannot be copied from itself" },
  );

/** Which env keys receive which DB field when wiring an app to a database (keys only). */
export const WireMappingSchema = z
  .strictObject({
    host: EnvKeySchema.optional(),
    port: EnvKeySchema.optional(),
    user: EnvKeySchema.optional(),
    password: EnvKeySchema.optional(),
    database: EnvKeySchema.optional(),
    url: EnvKeySchema.optional(),
  })
  .refine(
    (m) => {
      const keys = Object.values(m).filter((k): k is string => typeof k === "string");
      return keys.length > 0 && new Set(keys).size === keys.length;
    },
    { message: "mapping needs at least one key and keys must be distinct" },
  )
  .refine((m) => Object.values(m).every((k) => typeof k !== "string" || !isExposedEnvKey(k)), {
    message: "database values cannot go into browser-exposed keys",
  });
export type WireMapping = z.infer<typeof WireMappingSchema>;

/** Max length of a user-entered env value (Liara stores strings; PEM keys fit). */
export const MAX_ENV_VALUE_LENGTH = 16_384;

/**
 * Body part of the execute request carrying user-entered values for `valueSource:'user'`
 * keys. Lives only in the request; must never be stored, logged, audited or echoed.
 */
export const UserEnvValuesSchema = z
  .record(
    EnvKeySchema,
    z
      .string()
      .max(MAX_ENV_VALUE_LENGTH)
      .refine((v) => !v.includes("\u0000"), { message: "NUL not allowed" }),
  )
  .refine((r) => Object.keys(r).length <= MAX_ENV_CHANGES, { message: "too many values" });
export type UserEnvValues = z.infer<typeof UserEnvValuesSchema>;

/** Keys whose values the user must type at approval time, sorted and unique. */
export function userValueKeysOf(changes: readonly EnvChange[]): string[] {
  const keys = new Set<string>();
  for (const c of changes) if (c.op === "set" && c.valueSource === "user") keys.add(c.key);
  return [...keys].sort();
}

/** Exact-cover check between required user-entered keys and the submitted values. */
export function checkUserEnvValues(
  requiredKeys: readonly string[],
  values: UserEnvValues,
): { ok: true } | { ok: false; missing: string[]; unexpected: string[] } {
  const required = new Set(requiredKeys);
  const given = Object.keys(values);
  const missing = [...required].filter((k) => !Object.prototype.hasOwnProperty.call(values, k));
  const unexpected = given.filter((k) => !required.has(k));
  return missing.length === 0 && unexpected.length === 0
    ? { ok: true }
    : { ok: false, missing, unexpected };
}
