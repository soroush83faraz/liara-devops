// Audit helpers for the actions layer: best-effort append (a failing audit never masks the real outcome; the
// failure is logged without content) and a stable id for each stored entry.
import type { AuditEntry } from "@/lib/contracts/audit";
import { appendAudit, type AuditInput } from "@/lib/security/audit";
import { canonicalJson, sha256Hex } from "@/lib/security/canonical";
import type { Store } from "@/lib/security/store";
import { safeLog } from "./log";

export async function auditSafe(
  store: Pick<Store, "audit">,
  accountId: string,
  input: AuditInput,
  opts: { knownSecrets?: readonly string[]; now?: number } = {},
): Promise<AuditEntry | undefined> {
  try {
    return await appendAudit(store, accountId, input, { knownSecrets: opts.knownSecrets, now: opts.now });
  } catch (e) {
    safeLog("audit_append_failed", e);
    return undefined;
  }
}

/** Deterministic id of a stored audit entry (`aud_` + 24 hex), used by /api/ops and /api/audit. */
export function auditIdOf(entry: AuditEntry): string {
  return `aud_${sha256Hex(`hamyar.audit.v1\n${canonicalJson(entry)}`).slice(0, 24)}`;
}
