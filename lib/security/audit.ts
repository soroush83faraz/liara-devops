import {
  AUDIT_DETAIL_MAX,
  AuditEntrySchema,
  type AuditActor,
  type AuditEntry,
  type AuditResult,
  type AuditTarget,
} from "../contracts/audit";
import { redactDeep } from "./redact";
import type { Store } from "./store";

/** Audit log of every mutation attempt (who/when/what/params hash/result). */

export interface AuditInput {
  /** ISO timestamp; defaults to now. */
  ts?: string;
  actor: AuditActor;
  /** ActionType or another operation code (`session.connect`, `domain.add`, ...). */
  action: string;
  target: AuditTarget;
  /** hashParams(params) of the attempted operation (never the params themselves). */
  paramsHash: string;
  result: AuditResult;
  detail?: string;
  proposalId?: string;
}

export interface AppendAuditOptions {
  /** Env values / DB passwords in play, scrubbed by exact match. */
  knownSecrets?: readonly string[];
  now?: number | Date;
}

/**
 * Redacts (patterns + knownSecrets) and validates, then appends. Throws on an
 * invalid entry or a store failure; callers decide whether that blocks the action.
 */
export async function appendAudit(
  store: Pick<Store, "audit">,
  accountId: string,
  entry: AuditInput,
  opts: AppendAuditOptions = {},
): Promise<AuditEntry> {
  const now = opts.now === undefined ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const redacted = redactDeep({ ...entry, ts: entry.ts ?? new Date(now).toISOString() }, { knownSecrets: opts.knownSecrets });
  // Truncate only after redaction, so a cut can never expose part of a secret.
  if (typeof redacted.detail === "string" && redacted.detail.length > AUDIT_DETAIL_MAX) {
    redacted.detail = `${redacted.detail.slice(0, AUDIT_DETAIL_MAX - 1)}…`;
  }
  const valid = AuditEntrySchema.parse(redacted);
  await store.audit.append(accountId, valid);
  return valid;
}

/** Newest first; limit defaults to 100 (max 1000). */
export function readAudit(store: Pick<Store, "audit">, accountId: string, opts?: { limit?: number }): Promise<AuditEntry[]> {
  return store.audit.read(accountId, opts);
}
