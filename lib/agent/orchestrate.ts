// The copilot pipeline. Deterministic code does the work (routing, evidence, levels, proposals); the LLM
// only interprets. Every stage reports progress as typed data parts with stable ids.
import { generateText } from "ai";
import { FindingSchema, type Finding, type UnknownItem } from "@/lib/contracts/hypothesis";
import type { IncidentTimelineEntry, Proposal } from "@/lib/contracts/proposal";
import { buildRuleFindings, type RuleFindings } from "@/lib/evidence/hypotheses-rules";
import type { AppFacts, EvidenceBundle, PlanLimits } from "@/lib/evidence/types";
import type { probeApp } from "@/lib/canvas/probe";
import type { LiaraClient } from "@/lib/liara";
import { createRedactor, selectKnownSecrets } from "@/lib/security/redact";
import { getDefaultStore, type Store } from "@/lib/security/store";
import { buildAnswer, tpl } from "./answer";
import { allSourcesFailed, anySourceFailed, collectWithSteps } from "./collect-step";
import { buildDigest } from "./digest";
import type { Emitter } from "./emit";
import { ANSWER_FA, CLARIFY_FA, ERROR_FA, EXPLAIN_FALLBACK_FA, REFUSE_FA, SETUP_REDIRECT_FA, STEP_LABEL_FA } from "./fa-messages";
import { getDefaultIncidentSink, toIncident, type IncidentSink } from "./incident-port";
import { ObservationLedger } from "./ledger";
import { callWithFallback } from "./llm-call";
import { mergeFindings, type MergedFindings } from "./merge";
import { hasGaps, runPass2, runRedactor } from "./pass2";
import { buildSystemPrompt, EXPLAIN_INSTRUCTIONS_FA } from "./prompts.fa";
import { buildProposal, type ProposeResult } from "./propose";
import { LLM_BUDGET, logUsage, type AgentModels } from "./provider";
import { readOnlyLiara } from "./readonly-liara";
import { routeIntent, type IntentResult } from "./route-intent";
import { toPlainText } from "./sanitize";
import { synthesize, type ModelSynthesis } from "./synthesize";
import { resolveTarget, type ResolvedTarget, type TargetHint } from "./target";

export interface AgentRequest {
  accountId: string;
  /** Last user message (plain text). */
  text: string;
  /** Earlier text turns, oldest first. */
  history: string[];
  target?: TargetHint;
}

export interface AgentDeps {
  liara: LiaraClient;
  /** null = LLM not configured (rule-only). */
  models: AgentModels | null;
  /** Exact secrets to scrub everywhere (session token...). */
  knownSecrets: readonly string[];
  store?: Pick<Store, "proposals">;
  incidents?: IncidentSink;
  probe?: typeof probeApp;
  now?: () => number;
  signal?: AbortSignal;
}

export interface RunSummary {
  intent: IntentResult["intent"];
  target?: ResolvedTarget;
  degraded: boolean;
  toolCalls: number;
  proposalId?: string;
  incidentId?: string;
}

const ANSWER_ID = "answer";

class Aborted extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}
const checkAbort = (s?: AbortSignal) => {
  if (s?.aborted) throw new Aborted();
};

export async function runAgent(req: AgentRequest, deps: AgentDeps, emit: Emitter): Promise<RunSummary> {
  const now = deps.now ?? Date.now;
  const signal = deps.signal;
  // SECURITY: the whole pipeline only ever sees a client that cannot send non-GET requests.
  const liara = readOnlyLiara(deps.liara);
  const models = deps.models;

  emit.step("intent", STEP_LABEL_FA.intent, "running");
  const intent = await routeIntent(req.text, models?.router?.model, signal);
  emit.step("intent", STEP_LABEL_FA.intent, "done", intent.intent);
  const summary: RunSummary = { intent: intent.intent, degraded: false, toolCalls: 0 };
  checkAbort(signal);

  if (intent.intent === "refuse") {
    // No evidence, no tool, no model call and no proposal for refused requests.
    emit.text(ANSWER_ID, intent.refuse === "shell" ? REFUSE_FA.shell : intent.refuse === "cross_app" ? REFUSE_FA.crossApp : REFUSE_FA.destructive);
    return summary;
  }
  if (intent.intent === "setup_redirect") {
    emit.text(ANSWER_ID, SETUP_REDIRECT_FA);
    return summary;
  }
  if (intent.intent === "clarify") {
    emit.text(ANSWER_ID, CLARIFY_FA.question);
    return summary;
  }
  if (intent.intent === "explain") {
    summary.degraded = !(await explain(req, models, emit, deps.knownSecrets, signal));
    return summary;
  }

  emit.step("target", STEP_LABEL_FA.target, "running");
  const resolved = await resolveTarget(liara, req.text, req.target);
  if (!resolved.ok) {
    emit.step("target", STEP_LABEL_FA.target, "failed", resolved.reason);
    const text =
      resolved.reason === "ambiguous"
        ? tpl(CLARIFY_FA.ambiguousTarget, { names: (resolved.candidates ?? []).join(", ") })
        : resolved.reason === "no_resources"
          ? CLARIFY_FA.noResources
          : resolved.reason === "not_found"
            ? ERROR_FA.target_not_found
            : CLARIFY_FA.whichTarget;
    emit.text(ANSWER_ID, text);
    return summary;
  }
  const target = resolved.target;
  summary.target = target;
  emit.step("target", STEP_LABEL_FA.target, "done", `${target.kind}:${target.name}`);
  checkAbort(signal);

  // PASS 1: deterministic evidence.
  const bundle = await collectWithSteps(liara, target, emit, { now, knownSecrets: deps.knownSecrets, ...(deps.probe ? { probe: deps.probe } : {}), ...(signal ? { signal } : {}) });
  checkAbort(signal);
  const ledger = new ObservationLedger(bundle.observations);
  let rules = buildRuleFindings({ observations: ledger.all, unknowns: bundle.unknowns });
  const diagnosing = intent.intent === "diagnose" || intent.intent === "action_request";
  const red = await runRedactor(liara, target, deps.knownSecrets);
  const digestOf = () =>
    buildDigest({ question: req.text, history: req.history.slice(-6), target, sources: bundle.sources, observations: ledger.all, candidates: rules.candidates, unknowns: rules.unknowns, redactor: red.redactor });

  // PASS 2: bounded read-only tool loop (only with an LLM and only when the evidence has gaps).
  let llmDown = !models;
  let intents: Awaited<ReturnType<typeof runPass2>>["intents"] = [];
  if (models && diagnosing && hasGaps(bundle, rules, diagnosing)) {
    const p2 = await runPass2({ models, digest: digestOf(), liara, target, ledger, red, plan: bundle.raw.plan as PlanLimits | undefined, emit, now, ...(deps.probe ? { probe: deps.probe } : {}), ...(signal ? { signal } : {}) });
    checkAbort(signal);
    summary.toolCalls = p2.calls;
    intents = p2.intents;
    if (p2.llmFailure) llmDown = true;
    if (p2.calls > 0) rules = buildRuleFindings({ observations: ledger.all, unknowns: bundle.unknowns });
  } else {
    emit.step("pass2", STEP_LABEL_FA.pass2, "skipped", models ? "no_gaps" : "llm_unconfigured");
  }

  // Synthesis (structured) -> validated, merged with the rule floor.
  let synthesis: ModelSynthesis | null = null;
  if (!llmDown && models) {
    emit.step("synthesis", STEP_LABEL_FA.synthesis, "running");
    const s = await synthesize(models, digestOf(), signal);
    checkAbort(signal);
    if (s.ok) {
      synthesis = s.synthesis;
      emit.step("synthesis", STEP_LABEL_FA.synthesis, "done", s.mode);
    } else {
      llmDown = true;
      emit.step("synthesis", STEP_LABEL_FA.synthesis, "failed", `rule_only:${s.failure}`);
    }
  } else {
    emit.step("synthesis", STEP_LABEL_FA.synthesis, "skipped", "rule_only");
  }
  if (llmDown) {
    summary.degraded = true;
    emit.error("llm_unavailable", ERROR_FA.llm_unavailable);
  }

  const merged = mergeFindings(rules, synthesis, ledger.all, red.redactor);
  const finding = assembleFinding(bundle, ledger, rules, merged);
  emit.finding(finding);
  checkAbort(signal);

  // Proposal: at most one, built by code from the top validated hypothesis.
  const notes: string[] = [];
  let proposal: Proposal | undefined;
  let developer: Finding["hypotheses"][number] | undefined;
  if (diagnosing) {
    emit.step("proposal", STEP_LABEL_FA.proposal, "running");
    const topH = finding.hypotheses[0];
    const meta = topH ? merged.meta.get(topH.id) : undefined;
    const app = bundle.raw.app as AppFacts | undefined;
    const result: ProposeResult = await buildProposal(
      {
        target,
        ...(topH ? { top: { hypothesis: topH, ...(meta?.cause ? { cause: meta.cause } : {}), ...(meta?.candidate ? { candidate: meta.candidate } : {}) } } : {}),
        observations: finding.facts,
        ...(app ? { app: { envKeys: app.envKeys, ...(app.configuredPort !== undefined ? { configuredPort: app.configuredPort } : {}), ...(app.planId ? { planId: app.planId } : {}), ...(app.scale !== undefined ? { scale: app.scale } : {}) } } : {}),
        ...(intent.requested ? { requested: intent.requested } : {}),
      },
      { accountId: req.accountId, liara, store: deps.store ?? getDefaultStore(), now, intents },
    );
    if (result.kind === "proposal") {
      proposal = result.proposal;
      summary.proposalId = proposal.id;
      if (result.betterThanRequested) notes.push(ANSWER_FA.betterAction);
      emit.proposal(proposal);
      emit.step("proposal", STEP_LABEL_FA.proposal, "done", proposal.type);
    } else {
      if (result.kind === "developer") developer = topH;
      else if (result.kind === "none" && result.reason === "restart_wont_help") notes.push(ANSWER_FA.restartWontHelp);
      else if (result.kind === "none" && result.reason === "no_plan") notes.push(ANSWER_FA.resizeNoPlan);
      else if (result.kind === "none" && result.reason === "weak_evidence") notes.push(ANSWER_FA.collectMoreEvidence);
      else if (result.kind === "none" && result.reason === "not_proposable" && intent.requested) notes.push(ANSWER_FA.requestedNotProposable);
      else if (result.kind === "none" && result.reason === "insufficient" && intent.requested) notes.push(ANSWER_FA.noEvidenceForAction);
      else if (result.kind === "failed") notes.push(ERROR_FA.proposal_failed);
      emit.step("proposal", STEP_LABEL_FA.proposal, result.kind === "failed" ? "failed" : "skipped", result.kind === "failed" || result.kind === "none" ? result.reason : result.kind);
    }
  }
  checkAbort(signal);

  // Incident record for investigations that found something.
  if (diagnosing && (finding.hypotheses.length > 0 || proposal)) {
    summary.incidentId = await recordIncident(req.accountId, target, finding, proposal, bundle, deps, emit, now);
  }

  const allFailed = allSourcesFailed(bundle);
  if (allFailed) notes.unshift(ANSWER_FA.allFailedNote);
  else if (anySourceFailed(bundle)) notes.unshift(ANSWER_FA.partialNote);
  const flagged = ledger.flaggedCount();
  if (flagged) notes.push(tpl(ANSWER_FA.flaggedNote, { count: flagged }));
  // Headline: built by code from the validated finding. Model prose only in the labelled, filtered block.
  const modelSummary = toPlainText(synthesis?.summaryFa, 600, red.redactor);
  emit.text(
    ANSWER_ID,
    buildAnswer({ finding, allSourcesFailed: allFailed, ...(modelSummary ? { modelSummary } : {}), ...(proposal ? { proposal } : {}), notes, ...(developer ? { developer } : {}) }),
  );
  return summary;
}

function assembleFinding(bundle: EvidenceBundle, ledger: ObservationLedger, rules: RuleFindings, merged: MergedFindings): Finding {
  const seen = new Set<string>();
  const unknowns: UnknownItem[] = [...rules.unknowns, ...merged.modelUnknowns].filter((u) => !seen.has(u.descriptionFa) && seen.add(u.descriptionFa)).slice(0, 10);
  const limits = allSourcesFailed(bundle) ? [ANSWER_FA.allFailedNote, ...bundle.limits] : bundle.limits;
  const base = { facts: [...ledger.all], ruledOut: rules.ruledOut, unknowns, limitsNote: limits.slice(0, 10) };
  const full = FindingSchema.safeParse({ ...base, hypotheses: merged.hypotheses });
  if (full.success) return full.data;
  // Should not happen (both inputs are validated); fall back to the pure rule finding, then to facts only.
  const ruleOnly = FindingSchema.safeParse({ ...base, hypotheses: rules.hypotheses });
  return ruleOnly.success ? ruleOnly.data : FindingSchema.parse({ ...base, hypotheses: [], ruledOut: [] });
}

async function recordIncident(
  accountId: string,
  target: ResolvedTarget,
  finding: Finding,
  proposal: Proposal | undefined,
  bundle: EvidenceBundle,
  deps: AgentDeps,
  emit: Emitter,
  now: () => number,
): Promise<string | undefined> {
  emit.step("incident", STEP_LABEL_FA.incident, "running");
  const at = new Date(now()).toISOString();
  const timeline: IncidentTimelineEntry[] = [
    { ts: bundle.collectedAt, kind: "investigated" },
    { ts: at, kind: "finding" },
    ...(proposal ? [{ ts: proposal.createdAt, kind: "proposed" as const, refId: proposal.id }] : []),
  ];
  const input = { target: { kind: target.kind, name: target.name } as const, finding, startedAt: bundle.collectedAt, timeline, ...(proposal ? { proposalId: proposal.id } : {}) };
  try {
    const sink = deps.incidents ?? (await getDefaultIncidentSink());
    const { incidentId } = await sink.create(accountId, input);
    emit.incident(toIncident(incidentId, accountId, input));
    emit.step("incident", STEP_LABEL_FA.incident, "done", sink.durable ? undefined : "memory_only");
    return incidentId;
  } catch {
    emit.step("incident", STEP_LABEL_FA.incident, "failed");
    return undefined;
  }
}

async function explain(req: AgentRequest, models: AgentModels | null, emit: Emitter, knownSecrets: readonly string[], signal?: AbortSignal): Promise<boolean> {
  if (!models) {
    emit.error("llm_unavailable", ERROR_FA.llm_unavailable);
    emit.text(ANSWER_ID, EXPLAIN_FALLBACK_FA);
    return false;
  }
  const redactor = createRedactor({ knownSecrets: selectKnownSecrets({ values: [...knownSecrets] }) });
  const out = await callWithFallback(
    models,
    "explain",
    async (h) => {
      const r = await generateText({
        model: h.model,
        instructions: `${buildSystemPrompt()}\n\n${EXPLAIN_INSTRUCTIONS_FA}`,
        prompt: redactor.string(req.text).slice(0, 2_000),
        maxOutputTokens: LLM_BUDGET.explain.maxOutputTokens,
        maxRetries: 0,
        timeout: LLM_BUDGET.explain.timeoutMs,
        ...(signal ? { abortSignal: signal } : {}),
      });
      logUsage("explain", h.id, r.totalUsage);
      return r.text;
    },
    signal,
  );
  const text = out.ok ? toPlainText(out.value, 2_000, redactor) : "";
  if (!text) {
    emit.error("llm_unavailable", ERROR_FA.llm_unavailable);
    emit.text(ANSWER_ID, EXPLAIN_FALLBACK_FA);
    return false;
  }
  emit.text(ANSWER_ID, text);
  return true;
}
