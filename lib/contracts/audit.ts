import { z } from "zod";
import { CodeSchema, IsoDateTimeSchema, REDACTED_MARKER, SafeIdSchema, Sha256HexSchema, TARGET_KINDS } from "./common";

/** One audit-log line. Persisted only after lib/security/audit has redacted it. */

export const AUDIT_ACTORS = ["user", "agent-approved-by-user", "system"] as const;
export const AuditActorSchema = z.enum(AUDIT_ACTORS);
export type AuditActor = z.infer<typeof AuditActorSchema>;

export const AUDIT_RESULTS = ["ok", "error", "denied"] as const;
export const AuditResultSchema = z.enum(AUDIT_RESULTS);
export type AuditResult = z.infer<typeof AuditResultSchema>;

export const AUDIT_TARGET_KINDS = [...TARGET_KINDS, "account"] as const;

export const AuditTargetSchema = z.strictObject({
  kind: z.enum(AUDIT_TARGET_KINDS),
  name: z.union([z.string().regex(/^[A-Za-z0-9._:-]{1,253}$/), z.literal(REDACTED_MARKER)]),
});
export type AuditTarget = z.infer<typeof AuditTargetSchema>;

export const AUDIT_DETAIL_MAX = 2000;

export const AuditEntrySchema = z.strictObject({
  ts: IsoDateTimeSchema,
  actor: AuditActorSchema,
  /** ActionType or another operation code (e.g. `session.connect`, `domain.add`). */
  action: CodeSchema,
  target: AuditTargetSchema,
  paramsHash: Sha256HexSchema,
  result: AuditResultSchema,
  detail: z.string().max(AUDIT_DETAIL_MAX).optional(),
  proposalId: SafeIdSchema.optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
