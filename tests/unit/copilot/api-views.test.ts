import { describe, expect, it } from "vitest";
import { REDACTED_MARKER, type AuditEntry } from "@/lib/contracts";
import { failingFinding, proposalFixtures, sampleIncident } from "@/lib/contracts/fixtures";
import { normalizeAudit, normalizeIncidentList, parseProposalPayload } from "@/lib/copilot/api";
import { auditActionLabel, distinctActions, filterAudit, isRedactedName, NO_FILTERS } from "@/lib/copilot/audit-view";
import { durationMinutes, outcomeOf } from "@/lib/copilot/incident-view";

const H = "a".repeat(64);
const entry = (o: Partial<AuditEntry>): AuditEntry => ({
  ts: "2026-10-22T08:00:00.000Z",
  actor: "user",
  action: "restart",
  target: { kind: "app", name: "shop" },
  paramsHash: H,
  result: "ok",
  ...o,
});

describe("incident list normalisation", () => {
  it("accepts full incidents, wrapped or bare, and sorts newest first", () => {
    const older = { ...sampleIncident, id: "inc_old", startedAt: "2026-10-01T00:00:00.000Z" };
    const rows = normalizeIncidentList({ incidents: [older, sampleIncident] });
    expect(rows.map((r) => r.id)).toEqual(["inc_demo_0001", "inc_old"]);
    expect(rows[0]).toMatchObject({ outcome: "verified", level: "strong", hasProposal: true, target: { name: "broken-shop" } });
    expect(normalizeIncidentList([sampleIncident])).toHaveLength(1);
  });
  it("accepts summaries and skips malformed rows", () => {
    const rows = normalizeIncidentList({ items: [{ id: "i1", target: { kind: "app", name: "a" }, startedAt: "2026-10-22T00:00:00.000Z", outcome: "not_verified", level: "weak" }, { id: 5 }, null, "x"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "not_verified", level: "weak", hasProposal: false });
    expect(normalizeIncidentList(null)).toEqual([]);
  });
  it("outcomes: only 'verified' reads as resolved", () => {
    expect(outcomeOf({ hasProposal: false })).toBe("none");
    expect(outcomeOf({ hasProposal: true })).toBe("pending");
    expect(outcomeOf({ hasProposal: true, outcome: "verified" })).toBe("verified");
    expect(durationMinutes("2026-10-22T08:00:00.000Z", "2026-10-22T08:06:00.000Z")).toBe(6);
    expect(durationMinutes("bad")).toBeNull();
    expect(failingFinding.hypotheses[0].level).toBe("strong");
  });
});

describe("proposal payloads", () => {
  it("accepts a bare or wrapped valid proposal, rejects garbage", () => {
    expect(parseProposalPayload(proposalFixtures.proposed)?.id).toBe(proposalFixtures.proposed.id);
    expect(parseProposalPayload({ proposal: proposalFixtures.proposed })?.id).toBe(proposalFixtures.proposed.id);
    expect(parseProposalPayload({ proposal: { id: "x" } })).toBeUndefined();
    expect(parseProposalPayload(null)).toBeUndefined();
  });
});

describe("audit view", () => {
  const rows = [
    entry({ ts: "2026-10-22T08:00:00.000Z", action: "set_env", result: "ok" }),
    entry({ ts: "2026-10-22T09:00:00.000Z", action: "restart", result: "error" }),
    entry({ ts: "2026-10-22T07:00:00.000Z", action: "domain.add", result: "denied", target: { kind: "account", name: REDACTED_MARKER } }),
  ];
  it("normalises entries (newest first) and skips invalid rows", () => {
    const out = normalizeAudit({ entries: [...rows, { nope: true }] });
    expect(out.map((e) => e.action)).toEqual(["restart", "set_env", "domain.add"]);
    expect(normalizeAudit([rows[0]])).toHaveLength(1);
    expect(normalizeAudit(undefined)).toEqual([]);
  });
  it("filters by action and result", () => {
    expect(filterAudit(rows, NO_FILTERS)).toHaveLength(3);
    expect(filterAudit(rows, { action: "restart", result: "all" })).toHaveLength(1);
    expect(filterAudit(rows, { action: "all", result: "denied" })).toHaveLength(1);
    expect(filterAudit(rows, { action: "restart", result: "ok" })).toHaveLength(0);
    expect(distinctActions(rows)).toEqual(["domain.add", "restart", "set_env"]);
  });
  it("labels known actions in Persian and shows unknown codes as-is; redacted names are recognised", () => {
    expect(auditActionLabel("set_env")).toMatchObject({ known: true, label: "تنظیم متغیر محیطی" });
    expect(auditActionLabel("domain.add").known).toBe(true);
    expect(auditActionLabel("weird.code")).toEqual({ label: "weird.code", known: false });
    expect(isRedactedName(REDACTED_MARKER)).toBe(true);
    expect(isRedactedName("shop")).toBe(false);
  });
});
