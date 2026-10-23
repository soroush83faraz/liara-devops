// verifyAction: observes the real state after an action and ends with a contract `Verification`:
//  verified      (a) every REQUIRED check for the action type passed, (b) no required check is unknown/skipped,
//                (c) no check failed, and (d) at least MIN_SIGNALS independent positive signals were observed;
//  not_verified  something observable is not as intended, or could not be proven (names the check);
//  failed        the action definitively did not take effect (resource missing, release failed, state unreadable).
// API acceptance is never a check: only reads of Liara state, HTTP probes and logs are.
//
// Check statuses: passed | failed | unknown (could not be observed: unreadable, empty log window, nothing to
// compare) | skipped (deliberately not performed, e.g. non-web app). unknown/skipped are never green and never
// count as a positive signal. Independent signal sources: state (applets/releases/app or DB detail), probe (HTTP
// 2xx x3), logs (originating error absent over a NON-EMPTY window), config (env keys / port read back).
//
// Required checks per action type                         min. independent positive signals
//  restart                 app_running, restart_observed     2  (runtime fix: e.g. state + probe, or state + logs)
//  set_env / unset_env     env_keys_applied, app_running,    2
//  / wire_db               restart_observed (unless the change was a no-op)
//  update_port             app_running, port_readback        2
//  redeploy_previous       new_release, app_running          2
//  resize (app)            app_running, plan_applied         2
//  scale app -> 1          app_running, scale_applied        2
//  scale app -> 0          app_stopped                       1  (state change: direct read-back is the proof)
//  scale / resize (db)     db_state                          1
//  create_app              resource_exists                   1
//  create_db               resource_exists, db_running       1
//  create_network          resource_exists                   1
//  delete_*                resource_gone                     1
//  deploy_plan             resource_exists per DB, env_keys_applied when keys are set; app_running when it deploys
//                          (then 2 signals)
// Every action: error_signature_absent is REQUIRED when the originating error is known (signature from the
// proposal's cited evidence or passed explicitly); otherwise it is optional and only counts when it passed over a
// non-empty log window. A failed probe_2xx always blocks; a skipped probe never counts.
// Runtime actions ALWAYS list probe_2xx (or probe_skipped) and error_signature_absent, even when a state check
// failed or was unknown. When Liara's instance list (applets) is unavailable, app_running falls back to the app
// detail + release state and restart_observed to the container events (both disclosed; see verify-app.ts).
// probe_2xx is a settling window (3 CONSECUTIVE 2xx >= 5 s apart within 90 s); error_signature_absent only judges
// log lines after the observed restart (earlier lines are reported as ignored).
// set_env may add behavior_changed (probe 5xx before -> 2xx now): disclosed, same "probe" source, never required.
import type { LiaraClient } from "@/lib/liara";
import { probeApp } from "@/lib/canvas/probe";
import { actionTarget, type ActionParams } from "@/lib/contracts/action";
import type { Observation } from "@/lib/contracts/observation";
import { SnapshotSchema, VerificationSchema, type Proposal, type Snapshot, type Verification, type VerificationCheck } from "@/lib/contracts/proposal";
import { dedupeSignatures, defaultSignatures, signaturesFromEvidence, type ErrorSignature } from "./signatures";
import { captureSnapshot } from "./snapshot";
import {
  currentReleaseNow,
  logSignatureCheck,
  probeChecks,
  recordBeforeAfterContrast,
  verifyAppRuntime,
  verifyAppStopped,
  verifyPortReadback,
  type AppExpectations,
  type VerifyEnv,
} from "./verify-app";
import { existsProbe, verifyAppCreated, verifyDbCreated, verifyDbState, verifyEnvKeys, verifyGone, verifyNetworkCreated } from "./verify-resources";
import { Checks, systemClock, type CheckEntry, type CheckSignal, type ProbeFn } from "./verify-support";

export type { ProbeFn } from "./verify-support";
export type { ErrorSignature } from "./signatures";

export const VERIFY_DEFAULT_TIMEOUT_MS = 120_000;
export const VERIFY_DEFAULT_POLL_MS = 3_000;
export const VERIFY_PROBE_COUNT = 3;
export const VERIFY_PROBE_GAP_MS = 5_000;
/** Settling window of the probes: 3 consecutive 2xx >= 5 s apart must occur within it (rolling restarts). */
export const VERIFY_PROBE_WINDOW_MS = 90_000;

export interface VerifyOptions {
  /** Dependency-injected probe (default probeApp). `null` = non-web app: probes skipped with an explicit note. */
  probe?: ProbeFn | null;
  wait?: { timeoutMs?: number; pollMs?: number };
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  /** Epoch ms when the mutation was sent; the log window starts here (default: verification start). */
  executedAt?: number;
  /** Observations of the investigation; signatures come from those cited by the proposal. */
  evidence?: readonly Observation[];
  signatures?: readonly ErrorSignature[];
  /** Override: did the action replace the running instances (e.g. false when an env change was a no-op)? */
  expectRestart?: boolean;
  /** false when the mutation's answer was lost (the state re-read could not confirm it). */
  mutationAcknowledged?: boolean;
  probeCount?: number;
  probeGapMs?: number;
  /** Settling window for the probes (default VERIFY_PROBE_WINDOW_MS). */
  probeWindowMs?: number;
}

export type VerificationProgress =
  | { kind: "check"; check: VerificationCheck }
  | { kind: "result"; verification: Verification };

const isProposal = (s: Proposal | ActionParams): s is Proposal => "paramsHash" in s && "params" in s;

const RESTARTING_TYPES = new Set(["restart", "set_env", "unset_env", "wire_db"]);

function appExpectations(p: ActionParams, override: boolean | undefined): AppExpectations | undefined {
  const expectRestart = override ?? RESTARTING_TYPES.has(p.type);
  switch (p.type) {
    case "restart":
    case "set_env":
    case "unset_env":
    case "wire_db":
    case "update_port":
      return { expectRestart, expectNewRelease: false };
    case "redeploy_previous":
      return { expectRestart: false, expectNewRelease: true };
    case "resize":
      return p.resource.kind === "app" ? { expectRestart: false, expectNewRelease: false, planId: p.planId } : undefined;
    case "scale":
      return p.resource.kind === "app" && p.scale === 1 ? { expectRestart: false, expectNewRelease: false, scale: 1 } : undefined;
    default:
      return undefined;
  }
}

function envKeyExpectations(p: ActionParams): { present: string[]; absent: string[] } {
  if (p.type === "set_env") {
    return { present: p.changes.filter((c) => c.op === "set").map((c) => c.key), absent: p.changes.filter((c) => c.op === "unset").map((c) => c.key) };
  }
  if (p.type === "unset_env") return { present: [], absent: [...p.keys] };
  if (p.type === "wire_db") return { present: Object.values(p.mapping).filter((k): k is string => typeof k === "string"), absent: [] };
  return { present: [], absent: [] };
}

function signaturesFor(p: ActionParams, subject: Proposal | ActionParams, opts: VerifyOptions): { sigs: ErrorSignature[]; originating: boolean } {
  const fromEvidence = isProposal(subject) && opts.evidence ? signaturesFromEvidence(opts.evidence, subject.evidenceIds) : [];
  const originating = fromEvidence.length > 0 || (opts.signatures?.length ?? 0) > 0;
  return { sigs: dedupeSignatures([...fromEvidence, ...(opts.signatures ?? []), ...defaultSignatures(p)]), originating };
}

async function runtimePhase(
  env: VerifyEnv,
  app: string,
  exp: AppExpectations,
  sigs: { sigs: ErrorSignature[]; originating: boolean },
  opts: VerifyOptions,
  checks: Checks,
  extra?: () => Promise<void>,
  beforeFailingStatus?: number,
): Promise<void> {
  const runtime = await verifyAppRuntime(env, app, exp, checks);
  if (extra) await extra();
  // The probes and the log check ALWAYS run and always appear in the result, whatever the state checks said:
  // a failed/unknown state check must never hide what the site and the logs actually show.
  const probe = opts.probe === undefined ? (liara: LiaraClient, name: string) => probeApp(liara, name) : opts.probe;
  // After a definitive failure nothing will settle: one plain series instead of the settling window.
  const windowMs = checks.anyFatal ? 0 : (opts.probeWindowMs ?? VERIFY_PROBE_WINDOW_MS);
  const gapMs = Math.max(opts.probeGapMs ?? VERIFY_PROBE_GAP_MS, 0);
  const probed = await probeChecks(env, app, probe, opts.probeCount ?? VERIFY_PROBE_COUNT, gapMs, checks, windowMs);
  recordBeforeAfterContrast(beforeFailingStatus, probed, checks);
  const beforeReleaseId = typeof env.before?.currentReleaseId === "string" && env.before.currentReleaseId ? env.before.currentReleaseId : undefined;
  const afterReleaseId = await currentReleaseNow(env, app, runtime.currentReleaseId);
  await logSignatureCheck(
    env,
    app,
    sigs.sigs,
    { restartAt: runtime.restartAt, restartResolutionMs: runtime.restartResolutionMs, beforeReleaseId, afterReleaseId },
    checks,
    sigs.originating,
  );
}

/**
 * The failing HTTP status (5xx) the investigation observed before a set_env, from the probe observations of the
 * evidence or a `probeStatus` in the before-snapshot; undefined when nothing failing was observed.
 */
export function beforeFailingStatus(evidence: readonly Observation[] | undefined, before: Snapshot | undefined): number | undefined {
  for (const o of evidence ?? []) {
    if (o.source !== "probe" || (o.kind !== "probe" && o.kind !== "http_status")) continue;
    const s = o.params.status;
    if (typeof s === "number" && Number.isInteger(s) && s >= 500 && s <= 599) return s;
  }
  const s = before?.probeStatus;
  return typeof s === "number" && Number.isInteger(s) && s >= 500 && s <= 599 ? s : undefined;
}

async function deployPlanPhase(env: VerifyEnv, p: Extract<ActionParams, { type: "deploy_plan" }>, opts: VerifyOptions, checks: Checks): Promise<void> {
  const plan = p.plan;
  for (const s of plan.steps) if (s.kind === "create_db") await verifyDbCreated(env, s, checks);
  const present = plan.steps.flatMap((s) =>
    s.kind === "set_env"
      ? s.changes.filter((c) => c.op === "set").map((c) => c.key)
      : s.kind === "wire_db"
        ? Object.values(s.mapping).filter((k): k is string => typeof k === "string")
        : [],
  );
  await verifyEnvKeys(env, plan.app, present, [], checks);
  if (!plan.steps.some((s) => s.kind === "deploy")) return;
  const sigs = dedupeSignatures([
    ...present.map((key) => ({ kind: "missing_env" as const, key })),
    ...plan.steps.flatMap((s) => (s.kind === "wire_db" ? [{ kind: "connection_error" as const, host: s.db }] : [])),
    ...(opts.signatures ?? []),
    { kind: "crash" },
    { kind: "oom" },
  ]);
  await runtimePhase(env, plan.app, { expectRestart: false, expectNewRelease: false }, { sigs, originating: (opts.signatures?.length ?? 0) > 0 }, opts, checks);
}

async function runPhases(env: VerifyEnv, p: ActionParams, subject: Proposal | ActionParams, opts: VerifyOptions, checks: Checks): Promise<void> {
  if (opts.mutationAcknowledged === false) {
    checks.add("mutation_acknowledged", false, "Liara did not answer the change request; the state was re-read but the change could not be confirmed");
  }
  const target = actionTarget(p);
  const keys = envKeyExpectations(p);
  if (keys.present.length || keys.absent.length) await verifyEnvKeys(env, target.name, keys.present, keys.absent, checks);

  const exp = appExpectations(p, opts.expectRestart);
  if (exp) {
    const portCheck = p.type === "update_port" ? () => verifyPortReadback(env, p.app, p.port, checks) : undefined;
    const contrastFrom = p.type === "set_env" ? beforeFailingStatus(opts.evidence, env.before) : undefined;
    await runtimePhase(env, target.name, exp, signaturesFor(p, subject, opts), opts, checks, portCheck, contrastFrom);
    return;
  }
  switch (p.type) {
    case "scale":
      if (p.resource.kind === "app") await verifyAppStopped(env, p.resource.name, checks);
      else await verifyDbState(env, p.resource.name, { scale: p.scale }, checks);
      return;
    case "resize":
      await verifyDbState(env, p.resource.name, { planId: p.planId }, checks);
      return;
    case "create_app":
      await verifyAppCreated(env, p, checks);
      return;
    case "create_db":
      await verifyDbCreated(env, p, checks);
      return;
    case "create_network":
      await verifyNetworkCreated(env, p.name, checks);
      return;
    case "delete_app":
    case "delete_db":
    case "delete_domain":
    case "delete_disk":
      await verifyGone(env, p.type.slice("delete_".length), existsProbe(env.liara, p), checks);
      return;
    case "deploy_plan":
      await deployPlanPhase(env, p, opts, checks);
      return;
    default:
      return;
  }
}

const strip = (c: CheckEntry): VerificationCheck => ({ name: c.name, passed: c.status === "passed", status: c.status, detail: c.detail });

/** Evidence source of each check name (unlisted names are bookkeeping, never a positive signal). */
const CHECK_SIGNAL: Readonly<Record<string, CheckSignal>> = {
  app_running: "state",
  restart_observed: "state",
  new_release: "state",
  scale_applied: "state",
  plan_applied: "state",
  app_stopped: "state",
  resource_exists: "state",
  resource_gone: "state",
  db_state: "state",
  db_running: "state",
  plan_matches: "state",
  platform_matches: "state",
  probe_2xx: "probe",
  // Same source as probe_2xx on purpose: the before/after contrast is disclosed, never an extra independent signal.
  behavior_changed: "probe",
  error_signature_absent: "logs",
  env_keys_applied: "config",
  port_readback: "config",
};

export interface VerificationPolicy {
  /** Check names that must be present and passed. */
  required: readonly string[];
  /** Minimum number of distinct positive signal sources. */
  minSignals: number;
}

/** The per-action table documented at the top of this file. */
export function verificationPolicy(p: ActionParams, opts: Pick<VerifyOptions, "expectRestart"> = {}): VerificationPolicy {
  const exp = appExpectations(p, opts.expectRestart);
  const keys = envKeyExpectations(p);
  const required: string[] = [];
  if (keys.present.length || keys.absent.length) required.push("env_keys_applied");
  if (exp) {
    required.push("app_running");
    if (exp.expectRestart) required.push("restart_observed");
    if (exp.expectNewRelease) required.push("new_release");
    if (exp.planId !== undefined) required.push("plan_applied");
    if (exp.scale !== undefined) required.push("scale_applied");
    if (p.type === "update_port") required.push("port_readback");
    return { required, minSignals: 2 };
  }
  switch (p.type) {
    case "scale":
      return { required: [p.resource.kind === "app" ? "app_stopped" : "db_state"], minSignals: 1 };
    case "resize":
      return { required: ["db_state"], minSignals: 1 };
    case "create_app":
    case "create_network":
      return { required: ["resource_exists"], minSignals: 1 };
    case "create_db":
      return { required: ["resource_exists", "db_running"], minSignals: 1 };
    case "delete_app":
    case "delete_db":
    case "delete_domain":
    case "delete_disk":
      return { required: ["resource_gone"], minSignals: 1 };
    case "deploy_plan": {
      const steps = p.plan.steps;
      const sets = steps.some((s) => (s.kind === "set_env" && s.changes.some((c) => c.op === "set")) || (s.kind === "wire_db" && Object.values(s.mapping).some((k) => typeof k === "string")));
      const deploys = steps.some((s) => s.kind === "deploy");
      return {
        required: [...(steps.some((s) => s.kind === "create_db") ? ["resource_exists"] : []), ...(sets ? ["env_keys_applied"] : []), ...(deploys ? ["app_running"] : [])],
        minSignals: deploys ? 2 : 1,
      };
    }
    default:
      return { required, minSignals: 1 };
  }
}

const SIGNAL_LABEL: Record<CheckSignal, string> = { state: "state", probe: "HTTP probe", logs: "logs", config: "read-back" };

export function buildVerification(checks: readonly CheckEntry[], before?: Snapshot, after?: Snapshot, policy?: VerificationPolicy): Verification {
  const list: CheckEntry[] = checks.length > 0 ? [...checks] : [{ name: "no_checks", passed: false, status: "unknown", detail: "no check could be run" }];
  const decided = list.some((c) => c.status === "failed");
  if (policy && !decided) {
    const req = new Set(policy.required);
    for (const c of list) if (req.has(c.name)) c.required = true;
    for (const name of policy.required) {
      if (!list.some((c) => c.name === name)) list.push({ name, passed: false, status: "unknown", required: true, detail: "this required check could not be performed" });
    }
    const blockingUnknown = list.some((c) => c.required && c.status !== "passed");
    if (!blockingUnknown) {
      const sources = new Set(list.filter((c) => c.status === "passed").map((c) => c.signal ?? CHECK_SIGNAL[c.name]).filter((s): s is CheckSignal => s !== undefined));
      if (sources.size < policy.minSignals) {
        const seen = [...sources].map((s) => SIGNAL_LABEL[s]).join(", ") || "none";
        list.push({
          name: "independent_signals",
          passed: false,
          status: "unknown",
          detail: `${policy.minSignals} independent positive signals are required, observed ${sources.size} (${seen}); a fix cannot be confirmed from one source`,
        });
      }
    }
  }
  const notPassed = (c: CheckEntry) => c.status !== "passed";
  // Keep every non-passed check when there are too many (the contract caps the list at 20).
  const capped = list.length <= 20 ? list : [...list.filter(notPassed), ...list.filter((c) => !notPassed(c))].slice(0, 20);
  const blocking = (c: CheckEntry) => c.status === "failed" || (c.required === true && c.status !== "passed") || c.name === "independent_signals" || c.name === "no_checks";
  const outcome = capped.some((c) => c.status === "failed" && c.fatal)
    ? "failed"
    : capped.some(blocking) || !capped.some((c) => c.status === "passed")
      ? "not_verified"
      : "verified";
  const b = before && SnapshotSchema.safeParse(before).success ? before : undefined;
  const a = after && SnapshotSchema.safeParse(after).success ? after : undefined;
  return VerificationSchema.parse({ checks: capped.map(strip), outcome, ...(b ? { before: b } : {}), ...(a ? { after: a } : {}) });
}

/**
 * Yields each check as soon as it completes, then `{kind:'result'}`; the generator also returns that
 * Verification. Liara/probe failures never throw out of here: they become failed checks.
 */
export async function* verifyAction(
  ctx: { liara: LiaraClient },
  subject: Proposal | ActionParams,
  before: Snapshot | undefined,
  opts: VerifyOptions = {},
): AsyncGenerator<VerificationProgress, Verification> {
  const p = isProposal(subject) ? subject.params : subject;
  const clock = { now: opts.now ?? systemClock.now, sleep: opts.sleep ?? systemClock.sleep };
  const start = clock.now();
  const env: VerifyEnv = {
    liara: ctx.liara,
    clock,
    signal: opts.signal,
    deadline: start + (opts.wait?.timeoutMs ?? VERIFY_DEFAULT_TIMEOUT_MS),
    pollMs: opts.wait?.pollMs ?? VERIFY_DEFAULT_POLL_MS,
    executedAt: opts.executedAt ?? start,
    before,
  };

  const checks = new Checks();
  const queue: CheckEntry[] = [];
  let wake: (() => void) | undefined;
  let finished = false;
  checks.onAdd = (c) => {
    queue.push(c);
    wake?.();
  };
  void runPhases(env, p, subject, opts, checks)
    .catch((e: unknown) => {
      const kind = (e as { kind?: unknown } | null)?.kind;
      checks.add("verification_error", false, `verification stopped early (${typeof kind === "string" ? kind : "error"})`);
    })
    .finally(() => {
      finished = true;
      wake?.();
    });
  while (!finished || queue.length > 0) {
    const next = queue.shift();
    if (next) {
      yield { kind: "check", check: strip(next) };
      continue;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
      if (finished || queue.length > 0) resolve();
    });
    wake = undefined;
  }
  if (opts.signal?.aborted) checks.add("verification_aborted", false, "verification was interrupted before it finished");
  const after = await captureSnapshot(ctx.liara, p, clock.now());
  const verification = buildVerification(checks.list, before, after, verificationPolicy(p, opts));
  yield { kind: "result", verification };
  return verification;
}

/** Drains the generator; convenience for callers that do not stream progress. */
export async function runVerification(gen: AsyncGenerator<VerificationProgress, Verification>): Promise<Verification> {
  for (;;) {
    const n = await gen.next();
    if (n.done) return n.value;
  }
}
