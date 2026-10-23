// executeAction: the single entry point that performs a mutation, shared by human ops (/api/ops) and
// approved proposals. It re-validates everything it is given (schema, source policy, user values) so a
// caller bug cannot widen what can run.
import {
  ACTION_POLICY,
  ActionParamsSchema,
  actionTarget,
  userValueKeys,
  type ActionParams,
} from "@/lib/contracts/action";
import { UserEnvValuesSchema, checkUserEnvValues } from "@/lib/contracts/env";
import { redactDeep } from "@/lib/security/redact";
import { ActionError, toActionError } from "./errors";
import { execResize, execRestart, execScale, execUpdatePort, type Outcome } from "./exec-app";
import { execCreateApp, execCreateDb, execCreateNetwork } from "./exec-create";
import { execDeleteApp, execDeleteDb, execDeleteDisk, execDeleteDomain } from "./exec-delete";
import { execSetEnv, execUnsetEnv, execWireDb } from "./exec-env";
import { execDeployPlan } from "./exec-plan";
import { execRedeployPrevious } from "./exec-redeploy";
import { Run, type ExecContext, type ExecOptions, type ExecResult } from "./run";

export type { ExecContext, ExecOptions, ExecResult, StepEvent, StepSink, DeployTiming } from "./run";

/** Who may run what: the assistant only aiProposable types, setup only deploy_plan, deletes only a human. */
export function assertSourceMayRun(type: ActionParams["type"], source: ExecOptions["source"]): void {
  const policy = ACTION_POLICY[type];
  if (source === "agent" && !policy.aiProposable) throw new ActionError("ai_not_allowed", { details: { type } });
  if (source === "setup" && type !== "deploy_plan") throw new ActionError("ai_not_allowed", { details: { type } });
  if (policy.tier === 3 && source !== "user") throw new ActionError("human_only", { details: { type } });
}

/**
 * Type-level policy plus what the type alone cannot express: the assistant may propose a deploy plan, but never
 * one that creates billed resources (create_app/create_db steps) — creation stays human/setup-initiated.
 */
export function assertParamsMayRun(p: ActionParams, source: ExecOptions["source"]): void {
  assertSourceMayRun(p.type, source);
  if (source === "agent" && p.type === "deploy_plan" && p.plan.steps.some((s) => s.kind === "create_app" || s.kind === "create_db")) {
    throw new ActionError("ai_not_allowed", { details: { type: p.type, reason: "creates_resources" } });
  }
}

/** Exact cover: every `valueSource:'user'` key has a value and no other value is accepted. */
export function assertUserValues(params: ActionParams, values: unknown): Record<string, string> {
  const given = values === undefined ? {} : values;
  const parsed = UserEnvValuesSchema.safeParse(given);
  if (!parsed.success) throw new ActionError("invalid", { details: { reason: "user_values_schema" } });
  const cover = checkUserEnvValues(userValueKeys(params), parsed.data);
  if (!cover.ok) {
    if (cover.missing.length > 0) throw new ActionError("missing_user_value", { details: { keys: cover.missing } });
    throw new ActionError("unexpected_user_value", { details: { keys: cover.unexpected } });
  }
  return parsed.data;
}

/**
 * Resource names that are public anyway (see Run). Env key names are deliberately NOT exempt: a proposal chooses
 * them, so exempting them could only ever un-scrub something.
 */
export function publicNamesOf(p: ActionParams): Set<string> {
  const out = new Set<string>([actionTarget(p).name]);
  const add = (v: unknown) => {
    if (typeof v === "string" && v) out.add(v);
  };
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        if (k === "from" || k === "mapping" || k === "changes") continue;
        if (["app", "db", "name", "network", "domain", "disk"].includes(k)) add(child);
        else walk(child);
      }
    }
  };
  walk(p);
  return out;
}

function dispatch(run: Run, p: ActionParams): Promise<Outcome> {
  switch (p.type) {
    case "restart":
      return execRestart(run, p);
    case "set_env":
      return execSetEnv(run, p);
    case "unset_env":
      return execUnsetEnv(run, p);
    case "scale":
      return execScale(run, p);
    case "update_port":
      return execUpdatePort(run, p);
    case "resize":
      return execResize(run, p);
    case "redeploy_previous":
      return execRedeployPrevious(run, p);
    case "wire_db":
      return execWireDb(run, p);
    case "deploy_plan":
      return execDeployPlan(run, p);
    case "create_app":
      return execCreateApp(run, p);
    case "create_db":
      return execCreateDb(run, p);
    case "create_network":
      return execCreateNetwork(run, p);
    case "delete_app":
      return execDeleteApp(run, p);
    case "delete_db":
      return execDeleteDb(run, p);
    case "delete_domain":
      return execDeleteDomain(run, p);
    case "delete_disk":
      return execDeleteDisk(run, p);
    default: {
      const unreachable: never = p;
      throw new ActionError("invalid", { details: { reason: "unknown_type", type: String((unreachable as { type?: unknown }).type) } });
    }
  }
}

/**
 * Performs one action exactly once (never retried). Returns a redacted, secret-free summary plus every secret
 * value touched (for audit scrubbing). Throws ActionError (with knownSecrets attached) on failure.
 */
export async function executeAction(ctx: ExecContext, params: ActionParams, opts: ExecOptions): Promise<ExecResult> {
  const parsed = ActionParamsSchema.safeParse(params);
  if (!parsed.success) throw new ActionError("invalid", { details: { reason: "params_schema" } });
  const p = parsed.data;
  assertParamsMayRun(p, opts.source);
  const userValues = assertUserValues(p, opts.userValues);
  const run = new Run(ctx, { ...opts, userValues }, publicNamesOf(p));
  run.secrets.addAll(Object.values(userValues));
  try {
    const out = await dispatch(run, p);
    const knownSecrets = run.knownSecrets();
    return {
      summary: redactDeep(out.summary, { knownSecrets }),
      ...(out.after ? { after: redactDeep(out.after, { knownSecrets }) } : {}),
      knownSecrets,
      ...(run.confirmedByReread ? { confirmedByReread: true } : {}),
    };
  } catch (e) {
    throw toActionError(e, run.knownSecrets());
  }
}
