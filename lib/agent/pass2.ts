// PASS 2: optional bounded tool loop, only when an LLM is configured and PASS 1 left gaps.
import { getApp, type LiaraClient } from "@/lib/liara";
import { probeApp } from "@/lib/canvas/probe";
import type { EvidenceBundle, PlanLimits } from "@/lib/evidence/types";
import type { RuleFindings } from "@/lib/evidence/hypotheses-rules";
import { createRedactor, selectKnownSecrets, type Redactor } from "@/lib/security/redact";
import type { Emitter } from "./emit";
import { STEP_LABEL_FA, TOOL_LABEL_FA } from "./fa-messages";
import type { ObservationLedger } from "./ledger";
import { LLM_BUDGET, type AgentModels, type LlmFailure } from "./provider";
import { runToolLoop } from "./synthesize";
import type { ResolvedTarget } from "./target";
import type { ProposeIntent, ToolRuntime } from "./tools";

const PROVIDER_DOWN: ReadonlySet<LlmFailure> = new Set<LlmFailure>(["auth", "quota", "model_unavailable", "rate_limited", "timeout", "network", "server"]);

export function hasGaps(bundle: EvidenceBundle, rules: RuleFindings, diagnosing: boolean): boolean {
  if (bundle.sources.some((s) => s.status === "failed")) return true;
  const top = rules.candidates[0];
  if (!top) return diagnosing;
  return top.evidence.level === "weak" || top.evidence.level === "insufficient";
}

/**
 * Builds the run redactor. For apps it reads the app detail once so env VALUES can be scrubbed from
 * everything a tool returns; they are used for exact-match redaction only and never stored or sent.
 */
export async function runRedactor(liara: LiaraClient, target: ResolvedTarget, knownSecrets: readonly string[]) {
  if (target.kind !== "app") return { redactor: createRedactor({ knownSecrets: selectKnownSecrets({ values: [...knownSecrets] }) }), secrets: [...knownSecrets], app: undefined, ok: true };
  try {
    const app = await getApp(liara, target.name);
    const secrets = selectKnownSecrets({ envs: app.envs ?? [], values: [...knownSecrets] });
    return { redactor: createRedactor({ knownSecrets: secrets }), secrets, app, ok: true };
  } catch {
    return { redactor: createRedactor({ knownSecrets: selectKnownSecrets({ values: [...knownSecrets] }) }), secrets: [...knownSecrets], app: undefined, ok: false };
  }
}

export interface Pass2Outcome {
  status: "done" | "skipped" | "aborted";
  intents: ProposeIntent[];
  calls: number;
  /** Set when the LLM itself is unusable (no point trying synthesis on the same provider). */
  llmFailure?: LlmFailure;
}

export async function runPass2(args: {
  models: AgentModels;
  digest: string;
  liara: LiaraClient;
  target: ResolvedTarget;
  ledger: ObservationLedger;
  red: Awaited<ReturnType<typeof runRedactor>>;
  plan?: PlanLimits;
  emit: Emitter;
  now: () => number;
  probe?: typeof probeApp;
  signal?: AbortSignal;
}): Promise<Pass2Outcome> {
  const { emit } = args;
  if (args.target.kind === "app" && !args.red.ok) {
    // Fail closed: without the env values we cannot guarantee redaction of tool output.
    emit.step("pass2", STEP_LABEL_FA.pass2, "skipped", "redaction_unavailable");
    return { status: "skipped", intents: [], calls: 0 };
  }
  emit.step("pass2", STEP_LABEL_FA.pass2, "running");
  const rt: ToolRuntime = {
    env: {
      liara: args.liara,
      target: args.target,
      now: args.now,
      knownSecrets: args.red.secrets,
      probe: args.probe ?? probeApp,
      ...(args.plan ? { plan: args.plan } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
      ...(args.red.app ? { app: args.red.app } : {}),
    },
    ledger: args.ledger,
    redactor: args.red.redactor as Redactor,
    maxCalls: LLM_BUDGET.toolLoop.maxToolCalls,
    calls: 0,
    intents: [],
    onEvent: (e) => {
      if (e.tool === "propose_action") return;
      const id = `tool-${e.callIndex}`;
      emit.step(id, TOOL_LABEL_FA[e.tool] ?? e.tool, e.status, e.error ?? (e.flaggedWithheld ? `flagged:${e.flaggedWithheld}` : undefined));
      for (const o of e.added) emit.observation(o);
    },
  };
  const res = await runToolLoop(args.models, args.digest, rt, args.signal);
  if (res.status === "aborted") return { status: "aborted", intents: rt.intents, calls: rt.calls };
  if (res.status === "skipped") {
    emit.step("pass2", STEP_LABEL_FA.pass2, "skipped", res.reason);
    // Only provider-level failures disable synthesis; an unexplained 400 on the tool call (often "tools not
    // supported" with an unhelpful message) still leaves the single structured call worth trying.
    const fatal = res.reason === "degraded" && res.failure && PROVIDER_DOWN.has(res.failure);
    return { status: "skipped", intents: rt.intents, calls: rt.calls, ...(fatal ? { llmFailure: res.failure } : {}) };
  }
  emit.step("pass2", STEP_LABEL_FA.pass2, "done", `calls:${rt.calls}`);
  return { status: "done", intents: rt.intents, calls: rt.calls };
}
