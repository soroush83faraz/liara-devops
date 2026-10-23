import { describe, expect, it } from "vitest";
import * as F from "../../../lib/contracts/fixtures";
import { DeployPlanSchema } from "../../../lib/contracts/deploy-plan";
import { FindingSchema } from "../../../lib/contracts/hypothesis";
import { ObservationSchema } from "../../../lib/contracts/observation";
import { IncidentSchema, PROPOSAL_STATUSES, ProposalSchema, VerificationSchema } from "../../../lib/contracts/proposal";
import { fingerprintState, hashParams } from "../../../lib/security/canonical";
import { containsSecret } from "../../../lib/security/redact";
import { assertProposalIntegrity, canTransition, makeIdempotencyKey } from "../../../lib/security/state-machine";

describe("synthetic fixtures", () => {
  it("are labelled synthetic", () => {
    expect(F.SYNTHETIC_NOTICE).toMatch(/SYNTHETIC/);
  });

  it("validate against their schemas", () => {
    for (const o of [...F.failingObservations, ...F.healthyObservations]) expect(ObservationSchema.safeParse(o).success, o.id).toBe(true);
    expect(FindingSchema.safeParse(F.failingFinding).success).toBe(true);
    expect(FindingSchema.safeParse(F.healthyFinding).success).toBe(true);
    expect(VerificationSchema.safeParse(F.sampleVerification).success).toBe(true);
    expect(VerificationSchema.safeParse(F.sampleNotVerified).success).toBe(true);
    expect(IncidentSchema.safeParse(F.sampleIncident).success).toBe(true);
    expect(DeployPlanSchema.safeParse(F.sampleDeployPlan).success).toBe(true);
    for (const p of [F.proposedSetEnv, F.proposedResize, F.proposedDeployPlan]) {
      const r = ProposalSchema.safeParse(p);
      expect(r.success, `${p.id}: ${r.success ? "" : r.error.issues.map((i) => i.message).join(", ")}`).toBe(true);
    }
  });

  it("include one proposal per status with a legal history", () => {
    expect(Object.keys(F.proposalFixtures).sort()).toEqual([...PROPOSAL_STATUSES].sort());
    for (const status of PROPOSAL_STATUSES) {
      const p = F.proposalFixtures[status];
      expect(ProposalSchema.safeParse(p).success, status).toBe(true);
      expect(p.status).toBe(status);
      const h = p.history ?? [];
      expect(h[0]?.status).toBe("proposed");
      expect(h[h.length - 1]?.status).toBe(status);
      for (let i = 1; i < h.length; i++) expect(canTransition(h[i - 1].status, h[i].status), `${status} step ${i}`).toBe(true);
    }
  });

  it("pin hashes that match the canonical hash functions", () => {
    expect(hashParams(F.fixtureSetEnvParams)).toBe(F.FIXTURE_HASHES.setEnvParams);
    expect(hashParams(F.fixtureResizeParams)).toBe(F.FIXTURE_HASHES.resizeParams);
    expect(hashParams(F.fixtureDeployPlanParams)).toBe(F.FIXTURE_HASHES.deployPlanParams);
    expect(fingerprintState(F.FIXTURE_STATE)).toBe(F.FIXTURE_HASHES.state);
    expect(
      makeIdempotencyKey({
        accountId: F.FIXTURE_ACCOUNT_ID,
        proposalId: F.proposedSetEnv.id,
        type: "set_env",
        paramsHash: F.FIXTURE_HASHES.setEnvParams,
      }),
    ).toBe(F.proposedSetEnv.idempotencyKey);
    for (const p of [...Object.values(F.proposalFixtures), F.proposedResize, F.proposedDeployPlan]) {
      expect(() => assertProposalIntegrity(p), p.id).not.toThrow();
    }
  });

  it("do not trip redaction (UI samples render as-is)", () => {
    const everything = JSON.stringify([
      F.failingFinding,
      F.healthyFinding,
      F.proposalFixtures,
      F.proposedResize,
      F.proposedDeployPlan,
      F.sampleIncident,
      F.sampleStreamEvents,
    ]);
    expect(containsSecret(everything)).toBe(false);
  });
});
