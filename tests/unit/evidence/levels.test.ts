import { describe, expect, it } from "vitest";
import { deriveEvidenceLevel, FindingSchema, HypothesisSchema, type EvidenceLevel } from "@/lib/contracts/hypothesis";
import { computeEvidenceLevel, validateCitations } from "@/lib/evidence/levels";
import { TEMPORAL_SUMMARY } from "@/lib/evidence/temporal";
import type { Observation } from "@/lib/evidence/types";

const o = (id: string, kind: Observation["kind"], params: Observation["params"], extra: Partial<Observation> = {}): Observation => ({
  id,
  kind,
  severity: "error",
  source: "liara:logs",
  summary: "evidence.test",
  text: "",
  params,
  ...extra,
});

const OBS: Observation[] = [
  o("O1", "missing_env", { key: "SESSION_SECRET", sig: 1 }),
  o("O2", "event", { within5min: 1 }, { summary: TEMPORAL_SUMMARY, source: "liara:releases" }),
  o("O3", "probe", { ok: 0, sig: 0 }, { source: "probe" }),
  o("O4", "config", { key: "SESSION_SECRET", inAppEnv: 1 }, { source: "liara:app" }),
  o("O5", "log_error", { sig: 1 }, { flagged: true }),
  o("O6", "event", { within5min: 0 }, { summary: TEMPORAL_SUMMARY }),
  o("O7", "metric", { metric: "cpu", sig: 1 }, { source: "liara:metrics" }),
];

const EXPECTED: Record<string, EvidenceLevel> = {
  // supported, signature, correlation, contradicted
  "0000": "insufficient", "0001": "insufficient", "0010": "insufficient", "0011": "insufficient",
  "0100": "insufficient", "0101": "insufficient", "0110": "insufficient", "0111": "insufficient",
  "1000": "weak", "1001": "insufficient",
  "1010": "medium", "1011": "weak",
  "1100": "medium", "1101": "weak",
  "1110": "strong", "1111": "medium",
};

describe("computeEvidenceLevel truth table (plan §4)", () => {
  for (const [bits, expected] of Object.entries(EXPECTED)) {
    const [sup, sig, cor, con] = bits.split("").map((b) => b === "1");
    it(`supported=${sup} signature=${sig} correlation=${cor} contradicted=${con} -> ${expected}`, () => {
      const supports = sup ? [sig ? "O1" : "O3", ...(cor ? ["O2"] : [])] : [...(sig ? ["O5"] : []), ...(cor ? ["O99"] : [])];
      const r = computeEvidenceLevel({ supports, contradicts: con ? ["O4"] : [] }, OBS);
      expect(r.level).toBe(expected);
      expect(r.level).toBe(deriveEvidenceLevel({ supported: sup, signature: sup && sig, correlation: sup && cor, contradicted: con }));
      expect(r.contradicted).toBe(con);
      if (con && sup) expect(r.rule.endsWith(".contradicted")).toBe(true);
    });
  }

  it("signature kinds are scoped by cause (CPU metric is not a memory/OOM signature)", () => {
    expect(computeEvidenceLevel({ supports: ["O7"], cause: "oom" }, OBS).level).toBe("weak");
    expect(computeEvidenceLevel({ supports: ["O7"], cause: "cpu_saturation" }, OBS).level).toBe("medium");
  });
  it("a correlation observation outside 5 min is not correlation", () => {
    expect(computeEvidenceLevel({ supports: ["O1", "O6"] }, OBS)).toMatchObject({ level: "medium", correlation: false });
  });
  it("flagged observations never count, as support or contradiction", () => {
    const r = computeEvidenceLevel({ supports: ["O5"], contradicts: ["O5"] }, OBS);
    expect(r.level).toBe("insufficient");
    expect(r.reasonCodes).toContain("flagged_support_ignored:O5");
  });
  it("explicit correlation input (rule engine) is honoured", () => {
    expect(computeEvidenceLevel({ supports: ["O1"], correlation: { within5min: true } }, OBS).level).toBe("strong");
  });
});

describe("validateCitations", () => {
  const base = { titleFa: "عنوان", explanationFa: "توضیح" };

  it("drops unknown ids and hypotheses without valid supports", () => {
    const r = validateCitations([{ id: "H1", ...base, supports: ["O1", "O42"] }, { id: "H2", ...base, supports: ["O77"] }, { id: "H3", ...base, supports: [] }], OBS);
    expect(r.hypotheses.map((h) => [h.id, h.supports])).toEqual([["H1", ["O1"]]]);
    expect(r.droppedCitations).toContainEqual({ hypothesis: "H1", observationId: "O42", reason: "unknown_id", role: "supports" });
    expect(r.droppedHypotheses.map((d) => d.hypothesis)).toEqual(["H2", "H3"]);
  });

  it("never raises a level above the claimed one (and stays schema-valid)", () => {
    const r = validateCitations([{ id: "H1", ...base, supports: ["O1", "O2"], level: "weak" }], OBS);
    expect(r.hypotheses[0].level).toBe("weak");
    expect(r.hypotheses[0].levelReason.rule).toMatch(/clamped$/);
    expect(HypothesisSchema.safeParse(r.hypotheses[0]).success).toBe(true);
  });

  it("lowers an over-claimed level to what the evidence supports", () => {
    const r = validateCitations([{ id: "H1", ...base, supports: ["O3"], level: "strong" }], OBS);
    expect(r.hypotheses[0].level).toBe("weak");
  });

  it("dropping citations can only lower the level", () => {
    const before = validateCitations([{ id: "H1", ...base, supports: ["O1", "O2"] }], OBS).hypotheses[0].level;
    const after = validateCitations([{ id: "H1", ...base, supports: ["O1", "O2"] }], OBS.filter((x) => x.id !== "O2")).hypotheses[0].level;
    expect([before, after]).toEqual(["strong", "medium"]);
  });

  it("removes flagged and duplicate citations, overlaps, and non-proposable action hints", () => {
    const r = validateCitations(
      [
        { id: "H1", ...base, supports: ["O1", "O1", "O5"], contradicts: ["O1", "O4"], actionHint: "delete_app" },
        { id: "H1", ...base, supports: ["O3"], actionHint: "rm -rf" },
        { ...base, supports: ["O7"], actionHint: "resize" },
      ],
      OBS,
    );
    expect(r.hypotheses.map((h) => [h.id, h.supports, h.contradicts, h.actionHint ?? null])).toEqual([
      ["H1", ["O1"], ["O4"], null],
      ["H2", ["O3"], [], null],
      ["H3", ["O7"], [], "resize"],
    ]);
    expect(r.droppedCitations.map((d) => d.reason).sort()).toEqual(["also_supports", "duplicate", "flagged"]);
    expect(r.droppedActionHints.map((d) => d.actionHint)).toEqual(["delete_app", "rm -rf"]);
  });

  it("hypotheses consisting only of flagged (injection) evidence are dropped", () => {
    const r = validateCitations([{ id: "H1", ...base, supports: ["O5"], actionHint: "restart" }], OBS);
    expect(r.hypotheses).toEqual([]);
  });

  it("output fits a schema-valid Finding", () => {
    const r = validateCitations([{ id: "H1", ...base, supports: ["O1", "O2"], contradicts: ["O4"] }], OBS);
    const finding = { facts: OBS.filter((x) => !x.flagged), hypotheses: r.hypotheses, ruledOut: [], unknowns: [] };
    expect(FindingSchema.safeParse(finding).success).toBe(true);
  });
});
