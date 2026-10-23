// What leaves the server for proposals and incidents: free text (model-written) is redacted and clipped to
// the contract limits, so the view still validates against the contract schemas.
import type { Incident, Proposal } from "@/lib/contracts/proposal";
import { redactString } from "@/lib/security/redact";
import { sanitizeFinding } from "./incidents";

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const red = (s: string, max: number) => clip(redactString(s), max);

export function viewProposal(p: Proposal): Proposal {
  return {
    ...p,
    rationaleFa: red(p.rationaleFa, 2000),
    effectFa: red(p.effectFa, 1000),
    risksFa: p.risksFa.map((r) => red(r, 500)),
    verificationPlan: p.verificationPlan.map((v) => red(v, 300)),
  };
}

export function viewIncident(i: Incident): Incident {
  try {
    return { ...i, finding: sanitizeFinding(i.finding), timeline: i.timeline.map((t) => (t.textFa ? { ...t, textFa: red(t.textFa, 500) } : t)) };
  } catch {
    // Could not re-validate after redaction: drop free text rather than risk showing it unredacted.
    return {
      ...i,
      finding: { facts: [], hypotheses: [], ruledOut: [], unknowns: [] },
      timeline: i.timeline.map((t) => ({ ts: t.ts, kind: t.kind, ...(t.refId ? { refId: t.refId } : {}) })),
    };
  }
}

export interface IncidentSummary {
  id: string;
  target: Incident["target"];
  startedAt: string;
  resolvedAt?: string;
  proposalId?: string;
  outcome?: "verified" | "not_verified" | "failed";
  /** Title of the first hypothesis (redacted), or null. */
  titleFa: string | null;
  observationCount: number;
}

export function summarizeIncident(i: Incident): IncidentSummary {
  const first = i.finding.hypotheses[0];
  return {
    id: i.id,
    target: i.target,
    startedAt: i.startedAt,
    ...(i.resolvedAt ? { resolvedAt: i.resolvedAt } : {}),
    ...(i.proposalId ? { proposalId: i.proposalId } : {}),
    ...(i.verification ? { outcome: i.verification.outcome } : {}),
    titleFa: first ? red(first.titleFa, 200) : null,
    observationCount: i.finding.facts.length,
  };
}
