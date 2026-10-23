// Deterministic proposal builder (IO side): fingerprints the target, builds the proposal with
// lib/security's createProposal (all derived fields computed there), and persists it. Never executes.
import { AiProposableActionParamsSchema, actionTarget } from "@/lib/contracts/action";
import type { Proposal } from "@/lib/contracts/proposal";
import { computeTargetFingerprint } from "@/lib/actions/fingerprint";
import { getMe, listAppPlans, type LiaraClient, type NormalizedPlan } from "@/lib/liara";
import { createProposal } from "@/lib/security/state-machine";
import type { Store } from "@/lib/security/store";
import { planAction, type PlanInput, type PlanOutcome } from "./propose-plan";
import type { ProposeIntent } from "./tools";

export interface ProposeDeps {
  accountId: string;
  liara: LiaraClient;
  store: Pick<Store, "proposals">;
  now: () => number;
  /** Model intents from propose_action: advisory only, logged as counts, never used as parameters. */
  intents?: readonly ProposeIntent[];
}

export type ProposeResult =
  | { kind: "proposal"; proposal: Proposal; betterThanRequested: boolean }
  | Exclude<PlanOutcome, { kind: "action" }>
  | { kind: "failed"; reason: "fingerprint" | "invalid" | "store" };

/** Plans for resize, read lazily only when the mapping needs them (shape of /v1/me is [VAL]). */
export async function loadPlans(liara: LiaraClient): Promise<{ all: NormalizedPlan[] } | null> {
  try {
    const me = await getMe(liara);
    return { all: listAppPlans(me, { availableOnly: false, region: "any", includeLegacy: true }) };
  } catch {
    return null;
  }
}

const needsPlans = (input: PlanInput) => input.top?.candidate?.actionHint === "resize" || input.requested === "resize";

export async function buildProposal(input: PlanInput, deps: ProposeDeps): Promise<ProposeResult> {
  const withPlans = needsPlans(input) && input.plans === undefined ? { ...input, plans: await loadPlans(deps.liara) } : input;
  const outcome = planAction(withPlans);
  if (deps.intents?.length) {
    const agrees = outcome.kind === "action" && deps.intents.some((i) => i.type === outcome.plan.params.type);
    console.info("[agent] model intents", { count: deps.intents.length, agreesWithCode: agrees });
  }
  if (outcome.kind !== "action") return outcome;

  // SECURITY: re-validate against the AI allowlist schema (cannot express create/delete) before anything else.
  const params = AiProposableActionParamsSchema.safeParse(outcome.plan.params);
  if (!params.success || outcome.plan.evidenceIds.length === 0) return { kind: "failed", reason: "invalid" };

  let stateFingerprint: string;
  try {
    stateFingerprint = await computeTargetFingerprint(deps.liara, actionTarget(params.data));
  } catch {
    return { kind: "failed", reason: "fingerprint" };
  }

  let proposal: Proposal;
  try {
    proposal = createProposal(
      {
        accountId: deps.accountId,
        params: params.data,
        source: "agent",
        rationaleFa: outcome.plan.rationaleFa,
        evidenceIds: outcome.plan.evidenceIds,
        effectFa: outcome.plan.effectFa,
        risksFa: outcome.plan.risksFa,
        verificationPlan: outcome.plan.verificationPlan,
        ...(outcome.plan.costEstimate ? { costEstimate: outcome.plan.costEstimate } : {}),
        stateFingerprint,
      },
      deps.now(),
    );
  } catch {
    return { kind: "failed", reason: "invalid" };
  }
  try {
    await deps.store.proposals.put(deps.accountId, proposal.id, proposal);
  } catch {
    return { kind: "failed", reason: "store" };
  }
  return { kind: "proposal", proposal, betterThanRequested: Boolean(outcome.betterThanRequested) };
}
