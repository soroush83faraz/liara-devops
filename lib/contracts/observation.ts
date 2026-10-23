import { z } from "zod";
import { CodeSchema, IsoDateTimeSchema, SafeKeySchema } from "./common";

/**
 * A deterministic, source-attributed fact extracted from Liara data or a probe.
 * `summary` is an i18n code (rendered with `params`); `text` is a short excerpt
 * that MUST already be redacted (lib/security/redact) before it is built.
 */

export const OBSERVATION_KINDS = [
  "log_error",
  "missing_env",
  "connection_error",
  "port_mismatch",
  "crash",
  "oom",
  "build_error",
  "http_status",
  "metric",
  "release_state",
  "applet_state",
  "event",
  "probe",
  "db_state",
  "config",
] as const;
export const ObservationKindSchema = z.enum(OBSERVATION_KINDS);
export type ObservationKind = z.infer<typeof ObservationKindSchema>;

export const OBSERVATION_SOURCES = [
  "liara:logs",
  "liara:events",
  "liara:releases",
  "liara:applets",
  "liara:metrics",
  "probe",
  "liara:app",
  "liara:db",
  "liara:build-logs",
] as const;
export const ObservationSourceSchema = z.enum(OBSERVATION_SOURCES);
export type ObservationSource = z.infer<typeof ObservationSourceSchema>;

export const SEVERITIES = ["info", "warn", "error"] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

/** `O1`, `O2`, ... assigned by the evidence engine; citations refer to these. */
export const ObservationIdSchema = z.string().regex(/^O[1-9][0-9]{0,3}$/);
export type ObservationId = z.infer<typeof ObservationIdSchema>;

export const OBSERVATION_TEXT_MAX = 4000;
export const OBSERVATION_PARAMS_MAX = 24;

export const ObservationParamsSchema = z
  .record(SafeKeySchema, z.union([z.string().max(500), z.number()]))
  .refine((r) => Object.keys(r).length <= OBSERVATION_PARAMS_MAX, { message: "too many params" });

export const ObservationSchema = z.strictObject({
  id: ObservationIdSchema,
  kind: ObservationKindSchema,
  severity: SeveritySchema,
  ts: IsoDateTimeSchema.optional(),
  source: ObservationSourceSchema,
  summary: CodeSchema,
  text: z.string().max(OBSERVATION_TEXT_MAX),
  params: ObservationParamsSchema,
  /** Set when the excerpt looks like prompt injection (lib/security/injection). */
  flagged: z.boolean().optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

/**
 * A fact cited by a Finding. It is the full (redacted) observation snapshot, so a
 * Finding or a persisted Incident is self-contained and renders without the stream.
 */
export const ObservationRefSchema = ObservationSchema;
export type ObservationRef = Observation;
