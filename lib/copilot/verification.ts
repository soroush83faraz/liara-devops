// Verification wording rules. "Fixed" is claimed ONLY for outcome === 'verified' with at least one check that
// strictly passed (`passed === true`) and no failed check. The server applies the per-action rule (required checks,
// two independent positive signals; lib/actions/verify.ts); this module re-checks the parts it can see so a
// malformed payload can never read as success. unknown/skipped checks are never shown green.
import { checkStatus, type Snapshot, type Verification, type VerificationCheck, type VerificationCheckStatus } from "@/lib/contracts";

export type Headline =
  | { kind: "pending" }
  | { kind: "verified"; /** some non-required checks were unknown/skipped */ partial?: boolean }
  | { kind: "not_verified"; failedCheck?: string; /** the blocking check could not be proven (vs. observed failing) */ unproven?: boolean }
  | { kind: "failed" };

export { checkStatus };
export type CheckDisplayStatus = VerificationCheckStatus;

export function verificationHeadline(v: Verification | undefined): Headline {
  if (!v) return { kind: "pending" };
  const checks = Array.isArray(v.checks) ? v.checks : [];
  const failed = checks.find((c) => checkStatus(c) === "failed");
  const unproven = checks.find((c) => checkStatus(c) !== "passed");
  const blocking = failed ?? unproven;
  const notVerified = (): Headline =>
    blocking ? { kind: "not_verified", failedCheck: blocking.name, ...(failed ? {} : { unproven: true }) } : { kind: "not_verified" };
  if (v.outcome === "verified") {
    const anyPassed = checks.some((c) => checkStatus(c) === "passed");
    if (!anyPassed || failed) return notVerified();
    return unproven ? { kind: "verified", partial: true } : { kind: "verified" };
  }
  if (v.outcome === "not_verified") return notVerified();
  return { kind: "failed" };
}

/** The only place that may print «مشکل برطرف شد». */
export function claimsFixed(h: Headline): boolean {
  return h.kind === "verified";
}

export function failedChecks(checks: readonly VerificationCheck[]): VerificationCheck[] {
  return checks.filter((c) => checkStatus(c) === "failed");
}

/** Checks that could not be proven (unknown) or were deliberately not performed (skipped). */
export function unprovenChecks(checks: readonly VerificationCheck[]): VerificationCheck[] {
  return checks.filter((c) => {
    const s = checkStatus(c);
    return s === "unknown" || s === "skipped";
  });
}

export interface SnapshotRow {
  key: string;
  before: string | number | boolean | null | undefined;
  after: string | number | boolean | null | undefined;
}

/** Union of snapshot keys: `before` keys first (their order), then keys only present in `after`. */
export function snapshotRows(before?: Snapshot, after?: Snapshot): SnapshotRow[] {
  const keys: string[] = [];
  for (const k of Object.keys(before ?? {})) keys.push(k);
  for (const k of Object.keys(after ?? {})) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => ({
    key,
    before: before && Object.prototype.hasOwnProperty.call(before, key) ? before[key] : undefined,
    after: after && Object.prototype.hasOwnProperty.call(after, key) ? after[key] : undefined,
  }));
}
