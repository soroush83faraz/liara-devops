import { describe, expect, it } from "vitest";
import { ACTION_POLICY, ACTION_TYPES, type ActionType } from "../../../lib/contracts/action";
import { AuditEntrySchema } from "../../../lib/contracts/audit";
import { CostSchema, DockerImageSchema, REDACTED_MARKER, TargetSchema, costFromHourly } from "../../../lib/contracts/common";
import { DeployPlanSchema, type DeployPlan } from "../../../lib/contracts/deploy-plan";
import { failingFinding, sampleDeployPlan, sampleIncident, sampleVerification } from "../../../lib/contracts/fixtures";
import { FindingSchema, HypothesisSchema, deriveEvidenceLevel, type Hypothesis } from "../../../lib/contracts/hypothesis";
import { CanvasLayoutSchema } from "../../../lib/contracts/layout";
import { ObservationSchema, type Observation } from "../../../lib/contracts/observation";
import { IncidentSchema, ProposalSchema, VerificationSchema } from "../../../lib/contracts/proposal";
import { HEX64, SAMPLE_PARAMS, makeProposal } from "./samples";

const obs: Observation = {
  id: "O1",
  kind: "missing_env",
  severity: "error",
  source: "liara:logs",
  summary: "obs.missing_env",
  text: "Error: SESSION_SECRET is not defined",
  params: { key: "SESSION_SECRET" },
};

describe("Observation", () => {
  it("accepts a valid observation and rejects unknown enums/fields", () => {
    expect(ObservationSchema.safeParse(obs).success).toBe(true);
    expect(ObservationSchema.safeParse({ ...obs, kind: "rce" }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...obs, source: "attacker" }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...obs, severity: "critical" }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...obs, extra: 1 }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...obs, summary: "خطا" }).success).toBe(false);
  });

  it("validates ids, sizes and params", () => {
    for (const id of ["O0", "X1", "O10000", "o1", "O1 ", ""]) expect(ObservationSchema.safeParse({ ...obs, id }).success, id).toBe(false);
    expect(ObservationSchema.safeParse({ ...obs, text: "x".repeat(4001) }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...obs, params: { nested: { a: 1 } } }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...obs, params: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i])) }).success).toBe(false);
    const polluted = ObservationSchema.safeParse({ ...obs, params: JSON.parse('{"__proto__": {"x": 1}, "constructor": "y"}') });
    if (polluted.success) expect(Object.keys(polluted.data.params)).not.toContain("constructor");
    expect(ObservationSchema.safeParse({ ...obs, ts: "yesterday" }).success).toBe(false);
  });
});

describe("evidence levels are rule-derived", () => {
  it("matches the plan's rule table for every combination", () => {
    const expected = (s: boolean, c: boolean, x: boolean, sup: boolean) => {
      if (!sup) return "insufficient";
      const order = ["insufficient", "weak", "medium", "strong"];
      let idx = s && c ? 3 : s || c ? 2 : 1;
      if (x) idx -= 1;
      return order[idx];
    };
    for (const s of [false, true]) {
      for (const c of [false, true]) {
        for (const x of [false, true]) {
          for (const sup of [false, true]) {
            expect(deriveEvidenceLevel({ signature: s, correlation: c, contradicted: x, supported: sup }), `${s}${c}${x}${sup}`).toBe(
              expected(s, c, x, sup),
            );
          }
        }
      }
    }
  });

  const base: Hypothesis = {
    id: "H1",
    titleFa: "عنوان",
    explanationFa: "توضیح",
    supports: ["O1"],
    contradicts: [],
    level: "medium",
    levelReason: { rule: "signature", signature: true, correlation: false, contradicted: false },
  };

  it("rejects a model-invented level", () => {
    expect(HypothesisSchema.safeParse(base).success).toBe(true);
    expect(HypothesisSchema.safeParse({ ...base, level: "strong" }).success).toBe(false);
    expect(HypothesisSchema.safeParse({ ...base, level: "weak" }).success).toBe(false);
  });

  it("rejects inconsistent reasons and citations", () => {
    expect(HypothesisSchema.safeParse({ ...base, contradicts: ["O2"] }).success).toBe(false); // contradicted flag false
    expect(HypothesisSchema.safeParse({ ...base, contradicts: ["O1"], levelReason: { ...base.levelReason, contradicted: true }, level: "weak" }).success).toBe(false);
    expect(HypothesisSchema.safeParse({ ...base, supports: [], level: "insufficient" }).success).toBe(false); // signature without support
    expect(HypothesisSchema.safeParse({ ...base, supports: ["O1", "O1"] }).success).toBe(false);
    expect(HypothesisSchema.safeParse({ ...base, actionHint: "rm_rf" }).success).toBe(false);
  });
});

describe("Finding citation integrity", () => {
  it("accepts the fixture finding", () => {
    expect(FindingSchema.safeParse(failingFinding).success).toBe(true);
  });

  it("rejects citations of observations that are not facts", () => {
    const bad = structuredClone(failingFinding);
    bad.hypotheses[0].supports = ["O1", "O9"];
    expect(FindingSchema.safeParse(bad).success).toBe(false);
    const bad2 = structuredClone(failingFinding);
    bad2.ruledOut[0].observationIds = ["O42"];
    expect(FindingSchema.safeParse(bad2).success).toBe(false);
    const bad3 = structuredClone(failingFinding);
    bad3.facts.push({ ...bad3.facts[0] });
    expect(FindingSchema.safeParse(bad3).success).toBe(false);
    const bad4 = structuredClone(failingFinding);
    bad4.hypotheses.push({ ...bad4.hypotheses[0] });
    expect(FindingSchema.safeParse(bad4).success).toBe(false);
  });
});

describe("Proposal invariants", () => {
  it("accepts a valid proposal of every type from its allowed source", () => {
    for (const t of ACTION_TYPES) {
      const r = ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS[t], t === "deploy_plan" ? { source: "setup", evidenceIds: [] } : {}));
      expect(r.success, `${t}: ${r.success ? "" : r.error.issues.map((i) => i.message).join(", ")}`).toBe(true);
    }
  });

  it("never lets the assistant propose a creation or delete", () => {
    for (const t of ACTION_TYPES.filter((x: ActionType) => !ACTION_POLICY[x].aiProposable)) {
      expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS[t], { source: "agent", evidenceIds: ["O1"] })).success, t).toBe(false);
    }
  });

  it("requires cited evidence for assistant proposals", () => {
    expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS.restart, { evidenceIds: [] })).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS.restart, { evidenceIds: ["O1", "O1"] })).success).toBe(false);
  });

  it("restricts setup proposals to deploy_plan", () => {
    expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS.restart, { source: "setup" })).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS.delete_app, { source: "setup" })).success).toBe(false);
  });

  it("binds type, target and reversibility to params and policy", () => {
    expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS.restart, { type: "delete_app" })).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS.restart, { target: { kind: "app", name: "other" } })).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS.scale, { target: { kind: "app", name: "shop-db" } })).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(SAMPLE_PARAMS.delete_app, { reversible: "yes" })).success).toBe(false);
  });

  it("requires a cost estimate for billed actions", () => {
    for (const t of ACTION_TYPES.filter((x: ActionType) => ACTION_POLICY[x].billed)) {
      const p = makeProposal(SAMPLE_PARAMS[t], t === "deploy_plan" ? { source: "setup", evidenceIds: [] } : {});
      delete p.costEstimate;
      expect(ProposalSchema.safeParse(p).success, t).toBe(false);
    }
    expect(CostSchema.safeParse({ perHourToman: 1000, perMonthToman: 1 }).success).toBe(false);
    expect(CostSchema.safeParse({ perHourToman: -1, perMonthToman: -720 }).success).toBe(false);
    expect(CostSchema.safeParse(costFromHourly(1041.67)).success).toBe(true);
  });

  it("bounds the lifetime and rejects unknown fields", () => {
    expect(ProposalSchema.safeParse(makeProposal(undefined, { expiresAt: "2026-10-22T08:00:00.000Z" })).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(undefined, { expiresAt: "2026-10-22T07:00:00.000Z" })).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(undefined, { expiresAt: "2026-10-22T09:00:00.001Z" })).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...makeProposal(), approvalToken: "v1.x.y" }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...makeProposal(), status: "done" }).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(undefined, { paramsHash: HEX64.toUpperCase() })).success).toBe(false);
    expect(ProposalSchema.safeParse(makeProposal(undefined, { id: "../p1" })).success).toBe(false);
  });
});

describe("Verification honesty", () => {
  it("verified requires at least one check and all passed", () => {
    expect(VerificationSchema.safeParse(sampleVerification).success).toBe(true);
    expect(VerificationSchema.safeParse({ checks: [], outcome: "verified" }).success).toBe(false);
    expect(
      VerificationSchema.safeParse({ checks: [{ name: "probe_2xx", passed: false, detail: "502" }], outcome: "verified" }).success,
    ).toBe(false);
  });

  it("not_verified must name a failed check; failed is always allowed", () => {
    expect(VerificationSchema.safeParse({ checks: [{ name: "probe_2xx", passed: true, detail: "" }], outcome: "not_verified" }).success).toBe(false);
    expect(VerificationSchema.safeParse({ checks: [], outcome: "not_verified" }).success).toBe(false);
    expect(VerificationSchema.safeParse({ checks: [], outcome: "failed" }).success).toBe(true);
  });
});

describe("Incident", () => {
  it("validates the fixture and rejects bad times / ids", () => {
    expect(IncidentSchema.safeParse(sampleIncident).success).toBe(true);
    expect(IncidentSchema.safeParse({ ...sampleIncident, resolvedAt: "2026-10-22T07:00:00.000Z" }).success).toBe(false);
    expect(IncidentSchema.safeParse({ ...sampleIncident, accountId: "../acct" }).success).toBe(false);
  });
});

describe("DeployPlan", () => {
  const clone = (): DeployPlan => structuredClone(sampleDeployPlan);

  it("accepts the sample plan", () => {
    expect(DeployPlanSchema.safeParse(sampleDeployPlan).success).toBe(true);
  });

  it("rejects totals that do not add up", () => {
    const p = clone();
    p.totals = costFromHourly(1);
    expect(DeployPlanSchema.safeParse(p).success).toBe(false);
  });

  it("rejects steps that touch another app, wrong order, duplicate ids or another network", () => {
    const otherApp = clone();
    const deploy = otherApp.steps.find((s) => s.kind === "deploy");
    if (deploy?.kind === "deploy") deploy.app = "victim-app";
    expect(DeployPlanSchema.safeParse(otherApp).success).toBe(false);

    const wireFirst = clone();
    wireFirst.steps = [wireFirst.steps[0], wireFirst.steps[2], wireFirst.steps[1], ...wireFirst.steps.slice(3)];
    expect(DeployPlanSchema.safeParse(wireFirst).success).toBe(false);

    const envFirst = clone();
    envFirst.steps = [envFirst.steps[3], ...envFirst.steps.filter((_, i) => i !== 3)];
    expect(DeployPlanSchema.safeParse(envFirst).success).toBe(false);

    const dupIds = clone();
    dupIds.steps[1] = { ...dupIds.steps[1], id: "S1" };
    expect(DeployPlanSchema.safeParse(dupIds).success).toBe(false);

    const otherNet = clone();
    const db = otherNet.steps.find((s) => s.kind === "create_db");
    if (db?.kind === "create_db") db.network = "other-net";
    expect(DeployPlanSchema.safeParse(otherNet).success).toBe(false);
  });

  it("validates docker image references", () => {
    for (const ok of ["nginx", "nginx:1.25", "registry.liara.ir/team/app:v1", "ghcr.io/o/app@sha256:" + "a".repeat(64), "localhost:5000/app"]) {
      expect(DockerImageSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["nginx;rm -rf /", "NGINX", "../x", "nginx:", "a b", "x".repeat(300), "$(curl evil)"]) {
      expect(DockerImageSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("Target", () => {
  it("validates names per kind", () => {
    expect(TargetSchema.safeParse({ kind: "app", name: "shop" }).success).toBe(true);
    expect(TargetSchema.safeParse({ kind: "domain", name: "shop.example.ir" }).success).toBe(true);
    expect(TargetSchema.safeParse({ kind: "app", name: "shop.example.ir" }).success).toBe(false);
    expect(TargetSchema.safeParse({ kind: "server", name: "shop" }).success).toBe(false);
    expect(TargetSchema.safeParse({ kind: "network", name: "net/../x" }).success).toBe(false);
  });

  it("fails fast on huge inputs", () => {
    const start = performance.now();
    expect(TargetSchema.safeParse({ kind: "domain", name: `${"a.".repeat(200_000)}ir` }).success).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("CanvasLayout and AuditEntry", () => {
  it("rejects prototype keys and out-of-range values in layouts", () => {
    const ok = { version: 1, nodes: { "app:shop": { x: 10, y: 20 } }, updatedAt: "2026-10-22T08:00:00.000Z" };
    expect(CanvasLayoutSchema.safeParse(ok).success).toBe(true);
    const polluted = CanvasLayoutSchema.safeParse({ ...ok, nodes: JSON.parse('{"__proto__": {"x": 1, "y": 2}}') });
    if (polluted.success) expect(Object.prototype.hasOwnProperty.call(polluted.data.nodes, "__proto__")).toBe(false);
    expect(CanvasLayoutSchema.safeParse({ ...ok, nodes: { constructor: { x: 1, y: 2 } } }).success).toBe(false);
    expect(CanvasLayoutSchema.safeParse({ ...ok, nodes: { "app:shop": { x: 1e9, y: 0 } } }).success).toBe(false);
    expect(CanvasLayoutSchema.safeParse({ ...ok, version: 2 }).success).toBe(false);
  });

  it("validates audit entries", () => {
    const entry = {
      ts: "2026-10-22T08:00:00.000Z",
      actor: "agent-approved-by-user",
      action: "set_env",
      target: { kind: "app", name: "shop" },
      paramsHash: HEX64,
      result: "ok",
    };
    expect(AuditEntrySchema.safeParse(entry).success).toBe(true);
    expect(AuditEntrySchema.safeParse({ ...entry, target: { kind: "app", name: REDACTED_MARKER } }).success).toBe(true);
    expect(AuditEntrySchema.safeParse({ ...entry, actor: "agent" }).success).toBe(false);
    expect(AuditEntrySchema.safeParse({ ...entry, target: { kind: "app", name: "shop\nfake" } }).success).toBe(false);
    expect(AuditEntrySchema.safeParse({ ...entry, detail: "x".repeat(2001) }).success).toBe(false);
    expect(AuditEntrySchema.safeParse({ ...entry, value: "secret" }).success).toBe(false);
  });
});
