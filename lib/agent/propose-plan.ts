// Pure cause -> action mapping. SECURITY: every parameter (key, port, target, plan) is taken from
// deterministic evidence or Liara data, never from model output; deletes/creates cannot be expressed.
import type { ActionParams } from "@/lib/contracts/action";
import { costFromHourly, type Cost } from "@/lib/contracts/common";
import { EnvKeySchema, isPublicEnvKey } from "@/lib/contracts/env";
import { PortSchema, DbNameSchema } from "@/lib/contracts/common";
import type { Hypothesis } from "@/lib/contracts/hypothesis";
import type { NormalizedPlan } from "@/lib/liara/account";
import type { RuleCandidate } from "@/lib/evidence/hypotheses-rules";
import type { Cause } from "@/lib/evidence/levels";
import { paramNum, paramStr } from "@/lib/evidence/observe";
import type { Observation } from "@/lib/evidence/types";
import { isSecretKey } from "@/lib/security/redact";
import { PROPOSAL_FA } from "./fa-messages";
import { NO_ACTION_CAUSES } from "./merge";
import type { RequestedAction } from "./route-intent";

export interface AppState {
  envKeys?: string[];
  configuredPort?: number;
  planId?: string;
  scale?: number;
}

export interface PlanInput {
  target: { kind: "app" | "db"; name: string };
  top?: { hypothesis: Hypothesis; cause?: Cause; candidate?: RuleCandidate };
  observations: readonly Observation[];
  app?: AppState;
  requested?: RequestedAction;
  plans?: { all: NormalizedPlan[] } | null;
}

export interface ActionPlan {
  params: ActionParams;
  evidenceIds: string[];
  rationaleFa: string;
  effectFa: string;
  risksFa: string[];
  verificationPlan: string[];
  costEstimate?: Cost;
}

export type PlanOutcome =
  | { kind: "action"; plan: ActionPlan; betterThanRequested?: boolean }
  | { kind: "developer"; cause: Cause }
  | { kind: "none"; reason: "no_candidate" | "restart_wont_help" | "not_proposable" | "no_plan" | "insufficient" | "weak_evidence" };

const fill = (t: string, p: Record<string, string | number | undefined>) => t.replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k] ?? "?"));

/**
 * `generated` only for values the app itself owns (session/signing secrets, salts). Credentials issued by a
 * third party (API keys, DB passwords, bot tokens, DSNs, URLs) must come from the user: a random value
 * there would only replace one error with another.
 */
export function valueSourceFor(key: string): "generated" | "user" {
  const k = key.toUpperCase();
  if (isPublicEnvKey(k)) return "user";
  if (/SALT|PEPPER/.test(k)) return "generated";
  if (/API|ACCESS|CLIENT|PRIVATE|PUBLIC|DSN|URL|URI|HOST|USER|WEBHOOK|PASSWORD|PASS|PWD|BOT|STRIPE|AWS|GOOGLE|SMTP|MAIL|DB_|DATABASE/.test(k)) return "user";
  if (/SECRET|SALT|PEPPER|SIGNING_KEY|ENCRYPTION_KEY|^APP_KEY$|CSRF|SESSION_KEY|COOKIE_KEY|JWT_KEY/.test(k)) return "generated";
  return isSecretKey(key) && /KEY$|TOKEN_SECRET$/.test(k) ? "generated" : "user";
}

const isLevelAtLeastMedium = (h: Hypothesis) => h.level === "strong" || h.level === "medium";
const usable = (obs: readonly Observation[], ids: readonly string[]) => ids.map((id) => obs.find((o) => o.id === id)).filter((o): o is Observation => Boolean(o && !o.flagged));

function verification(kind: "app" | "db", signature: boolean): string[] {
  const V = PROPOSAL_FA.verification;
  return kind === "db" ? [V.dbRunning] : [V.running, V.probes, ...(signature ? [V.signatureGone] : [])];
}

function stateEvidence(obs: readonly Observation[]): string[] {
  return obs.filter((o) => !o.flagged && ["applet_state", "probe", "release_state", "http_status", "crash"].includes(o.kind)).slice(0, 5).map((o) => o.id);
}

function restartPlan(app: string, evidenceIds: string[], requested: boolean, signature: boolean): ActionPlan {
  const P = PROPOSAL_FA.restart;
  return {
    params: { type: "restart", app },
    evidenceIds,
    rationaleFa: requested ? P.rationaleRequested : P.rationale,
    effectFa: fill(P.effect, { app }),
    risksFa: [...P.risks],
    verificationPlan: verification("app", signature),
  };
}

function nextPlan(plans: NormalizedPlan[], currentId: string | undefined, need: "ram" | "cpu"): { from: NormalizedPlan; to: NormalizedPlan } | undefined {
  const from = plans.find((p) => p.id === currentId);
  if (!from) return undefined;
  const bigger = plans.filter((p) => {
    if (!p.available || p.legacy || p.id === from.id || !p.priceKnown || !(p.pricePerHour > 0)) return false;
    const ram = p.ramGb ?? 0;
    const cpu = p.cpu ?? 0;
    const okRam = ram >= (from.ramGb ?? 0);
    const okCpu = cpu >= (from.cpu ?? 0);
    return okRam && okCpu && (need === "ram" ? ram > (from.ramGb ?? 0) : cpu > (from.cpu ?? 0));
  });
  bigger.sort((a, b) => a.pricePerHour - b.pricePerHour);
  return bigger[0] ? { from, to: bigger[0] } : undefined;
}

/** Evidence-derived action for the top hypothesis (no user request involved). */
function derived(input: PlanInput): PlanOutcome {
  const top = input.top;
  if (!top || !top.cause) return { kind: "none", reason: "no_candidate" };
  const { hypothesis: h, cause, candidate } = top;
  if (NO_ACTION_CAUSES.has(cause)) return { kind: "developer", cause };
  // Only rule-backed causes may lead to an action; a model-only hypothesis cannot trigger one.
  if (!candidate || candidate.cause !== cause) return { kind: "none", reason: "no_candidate" };
  // Weak or insufficient evidence never leads to a state-changing proposal; the answer asks for more evidence instead.
  if (!isLevelAtLeastMedium(h)) return { kind: "none", reason: "weak_evidence" };
  const obs = usable(input.observations, h.supports);
  const ids = obs.map((o) => o.id).slice(0, 30);
  const sig = h.levelReason.signature;
  const t = input.target;

  switch (cause) {
    case "missing_env": {
      if (candidate.actionHint !== "set_env" || h.levelReason.contradicted || !isLevelAtLeastMedium(h) || t.kind !== "app") break;
      const key = obs.map((o) => (o.kind === "missing_env" ? paramStr(o, "key") : undefined)).find(Boolean);
      if (!key || !EnvKeySchema.safeParse(key).success) break;
      if (input.app?.envKeys?.includes(key)) break;
      const source = valueSourceFor(key);
      const P = PROPOSAL_FA.set_env;
      return {
        kind: "action",
        plan: {
          params: { type: "set_env", app: t.name, changes: [source === "generated" ? { op: "set", key, valueSource: "generated", generator: "base64url32" } : { op: "set", key, valueSource: "user" }] },
          evidenceIds: ids,
          rationaleFa: fill(P.rationale, { key }),
          effectFa: fill(source === "generated" ? P.effectGenerated : P.effectUser, { key }),
          risksFa: [...P.risks],
          verificationPlan: verification("app", sig),
        },
      };
    }
    case "wrong_port": {
      if (candidate.actionHint !== "update_port" || !isLevelAtLeastMedium(h) || t.kind !== "app") break;
      const o = obs.find((x) => x.summary === "evidence.port.listen_differs");
      const port = o ? paramNum(o, "listenPort") : undefined;
      if (!o || !PortSchema.safeParse(port).success) break;
      const P = PROPOSAL_FA.update_port;
      return {
        kind: "action",
        plan: {
          params: { type: "update_port", app: t.name, port: port as number },
          evidenceIds: ids,
          rationaleFa: fill(P.rationale, { listenPort: port, configuredPort: paramNum(o, "configuredPort") }),
          effectFa: fill(P.effect, { app: t.name, port }),
          risksFa: [...P.risks],
          verificationPlan: verification("app", sig),
        },
      };
    }
    case "db_unreachable": {
      if (candidate.actionHint !== "scale") break;
      const o = obs.find((x) => x.summary === "evidence.db.stopped");
      const db = o ? paramStr(o, "hostname") : undefined;
      if (!db || !DbNameSchema.safeParse(db).success) break;
      const P = PROPOSAL_FA.scale_db;
      return {
        kind: "action",
        plan: {
          params: { type: "scale", resource: { kind: "db", name: db }, scale: 1 },
          evidenceIds: ids,
          rationaleFa: fill(P.rationale, { db }),
          effectFa: fill(P.effect, { db }),
          risksFa: [...P.risks],
          verificationPlan: verification("db", sig),
        },
      };
    }
    case "oom":
    case "cpu_saturation": {
      if (t.kind !== "app") break;
      if (cause === "oom" && candidate.actionHint === "restart" && ids.length) return { kind: "action", plan: restartPlan(t.name, ids, false, sig) };
      if (candidate.actionHint !== "resize" || !sig || h.levelReason.contradicted) break;
      const step = input.plans ? nextPlan(input.plans.all, input.app?.planId, cause === "oom" ? "ram" : "cpu") : undefined;
      if (!step) return { kind: "none", reason: "no_plan" };
      const P = PROPOSAL_FA.resize;
      return {
        kind: "action",
        plan: {
          params: { type: "resize", resource: { kind: "app", name: t.name }, planId: step.to.id },
          evidenceIds: ids,
          rationaleFa: cause === "oom" ? P.rationaleMemory : P.rationaleCpu,
          effectFa: fill(P.effect, { app: t.name, from: step.from.id, to: step.to.id }),
          risksFa: [...P.risks],
          verificationPlan: verification("app", sig),
          // nextPlan only returns priced targets, so this is never a made-up 0.
          costEstimate: costFromHourly(step.to.pricePerHour),
        },
      };
    }
    default:
      break;
  }
  return { kind: "none", reason: "no_candidate" };
}

/** Causes for which a restart demonstrably does not help (deterministic config/code/dependency errors, CPU-bound handlers). */
const RESTART_FUTILE: ReadonlySet<Cause> = new Set<Cause>(["missing_env", "wrong_port", "build_failure", "crash_after_release", "db_unreachable", "external_dependency", "cpu_saturation"]);

/** Applies a direct user request on top of the evidence-derived outcome. Evidence always wins. */
export function planAction(input: PlanInput): PlanOutcome {
  const base = derived(input);
  const req = input.requested;
  if (!req) return base;
  const t = input.target;
  if (base.kind === "action") {
    const same =
      (req === "restart" && base.plan.params.type === "restart") ||
      (req === "start" && base.plan.params.type === "scale") ||
      base.plan.params.type === req;
    return same ? base : { ...base, betterThanRequested: true };
  }
  const top = input.top;
  const strongCause = top?.cause && isLevelAtLeastMedium(top.hypothesis) ? top.cause : undefined;
  if (req === "restart") {
    if (strongCause && RESTART_FUTILE.has(strongCause)) return { kind: "none", reason: "restart_wont_help" };
    if (base.kind === "developer") return { kind: "none", reason: "restart_wont_help" };
    const ids = stateEvidence(input.observations);
    if (t.kind !== "app" || ids.length === 0) return { kind: "none", reason: "insufficient" };
    return { kind: "action", plan: restartPlan(t.name, ids, true, false) };
  }
  if ((req === "start" || req === "stop") && t.kind === "app") {
    const want = req === "start" ? 1 : 0;
    if (input.app?.scale === want) return { kind: "none", reason: "insufficient" };
    const ids = stateEvidence(input.observations);
    if (ids.length === 0) return { kind: "none", reason: "insufficient" };
    const P = PROPOSAL_FA.scale_app;
    return {
      kind: "action",
      plan: {
        params: { type: "scale", resource: { kind: "app", name: t.name }, scale: want },
        evidenceIds: ids,
        rationaleFa: P.rationaleRequested,
        effectFa: fill(want ? P.effectStart : P.effectStop, { app: t.name }),
        risksFa: [...P.risks],
        verificationPlan: want ? verification("app", false) : [PROPOSAL_FA.verification.stopped],
      },
    };
  }
  if (base.kind === "developer") return base;
  return { kind: "none", reason: req === "resize" ? (base.kind === "none" && base.reason === "no_plan" ? "no_plan" : "insufficient") : "not_proposable" };
}
