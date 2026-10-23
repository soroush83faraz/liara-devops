// Background execution of a claimed proposal: execute once -> verify -> terminal status -> audit -> incident.
// Runs detached from the HTTP request (client disconnects do not cancel it), bounded by its own deadline.
// User-typed values live only in this closure for the duration of the job.
import type { LiaraClient } from "@/lib/liara";
import type { Proposal, ProposalStatus, Snapshot, Verification } from "@/lib/contracts/proposal";
import { VerificationSchema, checkStatus } from "@/lib/contracts/proposal";
import { redactString } from "@/lib/security/redact";
import { casTransition } from "@/lib/security/state-machine";
import type { Store } from "@/lib/security/store";
import type { StoredSource } from "@/lib/setup/source-store";
import { auditSafe } from "./audit-log";
import { toActionError } from "./errors";
import { publishError, publishExecution, publishProposal, publishVerification } from "./events";
import { executeAction, type DeployTiming, type ExecResult } from "./executors";
import { jobKey, runningJobs } from "./globals";
import { attachVerification, findIncidentByProposal, recordIncidentEvent, resolveIncident } from "./incidents";
import { safeLog } from "./log";
import { messageFor } from "./messages";
import { captureSnapshot } from "./snapshot";
import { verifyAction, type VerifyOptions } from "./verify";

export const JOB_DEADLINE_MS = 30 * 60_000;

export interface JobDeps {
  store: Store;
  now: () => number;
  tokenKey?: Uint8Array;
  /** Verification overrides (tests: fake probe/clock, short waits). */
  verify?: Omit<VerifyOptions, "signal" | "executedAt" | "evidence" | "mutationAcknowledged">;
  deployTiming?: DeployTiming;
  getSource?: (accountId: string, ref: string) => Promise<StoredSource | null>;
  jobDeadlineMs?: number;
}

export interface JobInput {
  liara: LiaraClient;
  scope: { accountId: string; teamId: string };
  /** The claimed proposal (status `executing`). */
  proposal: Proposal;
  userValues: Record<string, string>;
  /** Releases the per-target lock taken by executeProposal. */
  release: () => void;
}

/** Scrubs free text only (details, snapshot values); check names and outcome are fixed codes. */
function redactVerification(v: Verification, secrets: readonly string[]): Verification {
  const scrub = (s: string) => redactString(s, { knownSecrets: secrets });
  const snap = (s: Snapshot | undefined) =>
    s ? Object.fromEntries(Object.entries(s).map(([k, val]) => [k, typeof val === "string" ? scrub(val).slice(0, 500) : val])) : undefined;
  const before = snap(v.before);
  const after = snap(v.after);
  return VerificationSchema.parse({
    checks: v.checks.map((c) => ({ ...c, detail: scrub(c.detail).slice(0, 500) })),
    outcome: v.outcome,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  });
}

function expectRestartFrom(exec: ExecResult | undefined): boolean | undefined {
  return exec?.summary.restartTriggered === false ? false : undefined;
}

async function finish(
  deps: JobDeps,
  accountId: string,
  p: Proposal,
  from: ProposalStatus[],
  to: ProposalStatus,
): Promise<Proposal> {
  const r = await casTransition(deps.store, accountId, p.id, from, to, deps.now());
  if (r.ok) return r.proposal;
  safeLog("job_transition_failed", { code: r.reason });
  return (await deps.store.proposals.get(accountId, p.id).catch(() => undefined)) ?? p;
}

export async function runProposalJob(deps: JobDeps, input: JobInput): Promise<void> {
  const { liara, proposal } = input;
  const { accountId } = input.scope;
  const id = proposal.id;
  const key = jobKey(accountId, id);
  runningJobs().set(key, deps.now());
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.jobDeadlineMs ?? JOB_DEADLINE_MS);
  const actor = proposal.source === "user" ? "user" : "agent-approved-by-user";
  const audit = (result: "ok" | "error", detail: string, secrets: readonly string[]) =>
    auditSafe(
      deps.store,
      accountId,
      { actor, action: proposal.type, target: proposal.target, paramsHash: proposal.paramsHash, result, detail: `${detail}; idk=${proposal.idempotencyKey}`, proposalId: id },
      { knownSecrets: secrets, now: deps.now() },
    );
  let secrets: string[] = [];
  try {
    const incident = await findIncidentByProposal(deps.store, accountId, id);
    const incidentEvent = (kind: "executing" | "executed" | "failed", textFa?: string) =>
      incident ? recordIncidentEvent(deps.store, accountId, incident.id, kind, { refId: id, textFa, now: deps.now() }).catch(() => undefined) : undefined;

    publishProposal(accountId, proposal);
    publishExecution(accountId, id, "execute", "running");
    await incidentEvent("executing");
    const before = await captureSnapshot(liara, proposal.params, deps.now());
    const executedAt = deps.now();

    let exec: ExecResult | undefined;
    let acknowledged = true;
    try {
      exec = await executeAction({ liara, accountId }, proposal.params, {
        userValues: input.userValues,
        source: proposal.source,
        signal: ac.signal,
        onStep: (e) => publishExecution(accountId, id, e.step, e.status, e.detail),
        deploy: deps.deployTiming,
        getSource: deps.getSource,
      });
      secrets = exec.knownSecrets;
      publishExecution(accountId, id, "execute", "done", exec.confirmedByReread ? "confirmed_by_reread" : undefined);
      await incidentEvent("executed");
    } catch (e) {
      const err = toActionError(e);
      secrets = [...err.knownSecrets];
      if (err.code !== "outcome_unknown") {
        publishExecution(accountId, id, "execute", "failed", err.code);
        const failed = await finish(deps, accountId, proposal, ["executing"], "failed");
        await audit("error", `execution_failed:${err.code}`, secrets);
        await incidentEvent("failed");
        publishError(accountId, id, err.code, messageFor(err.code));
        publishProposal(accountId, failed, true);
        return;
      }
      // The change may or may not have been applied: verify the real state, never resend the mutation.
      acknowledged = false;
      publishExecution(accountId, id, "execute", "failed", "outcome_unknown");
    }

    const verifying = await finish(deps, accountId, proposal, ["executing"], "verifying");
    publishProposal(accountId, verifying);
    let verification: Verification | undefined;
    const gen = verifyAction({ liara }, proposal, before, {
      ...deps.verify,
      signal: ac.signal,
      executedAt,
      evidence: incident?.finding.facts,
      expectRestart: deps.verify?.expectRestart ?? expectRestartFrom(exec),
      mutationAcknowledged: acknowledged,
    });
    for await (const progress of gen) {
      if (progress.kind === "check") {
        const detail = redactString(progress.check.detail, { knownSecrets: secrets }).slice(0, 500);
        const st = checkStatus(progress.check);
        publishExecution(accountId, id, `verify:${progress.check.name}`, st === "passed" ? "done" : st === "failed" ? "failed" : "skipped", detail);
      } else {
        verification = progress.verification;
      }
    }
    if (!verification) throw new Error("verification produced no result");
    verification = redactVerification(verification, secrets);
    const done = await finish(deps, accountId, proposal, ["verifying"], verification.outcome);
    const failedChecks = verification.checks.filter((c) => checkStatus(c) === "failed").map((c) => c.name);
    const unproven = verification.checks.filter((c) => checkStatus(c) === "unknown" || checkStatus(c) === "skipped").map((c) => c.name);
    await audit(
      verification.outcome === "failed" ? "error" : "ok",
      `verification:${verification.outcome}${failedChecks.length ? `; failed_checks:${failedChecks.join(",")}` : ""}${unproven.length ? `; unproven_checks:${unproven.join(",")}` : ""}${exec?.confirmedByReread ? "; confirmed_by_reread" : ""}`,
      secrets,
    );
    if (incident) {
      await attachVerification(deps.store, accountId, incident.id, verification, { proposalId: id, now: deps.now() }).catch(() => undefined);
      if (verification.outcome === "verified") await resolveIncident(deps.store, accountId, incident.id, { now: deps.now() }).catch(() => undefined);
    }
    publishVerification(accountId, id, verification);
    publishProposal(accountId, done, true);
  } catch (e) {
    safeLog("job_failed", e);
    const failed = await finish(deps, accountId, proposal, ["executing", "verifying"], "failed").catch(() => proposal);
    await audit("error", "internal_error", secrets);
    publishError(accountId, id, "internal", messageFor("internal"));
    publishProposal(accountId, failed, true);
  } finally {
    clearTimeout(timer);
    runningJobs().delete(key);
    input.release();
  }
}
