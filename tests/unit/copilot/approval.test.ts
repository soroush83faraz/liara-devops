import { describe, expect, it } from "vitest";
import { fixtureResizeParams, proposalFixtures, proposedDeployPlan, proposedResize, proposedSetEnv } from "@/lib/contracts/fixtures";
import type { Proposal } from "@/lib/contracts";
import {
  approveSucceeded,
  beginSubmit,
  canConfirm,
  executeSucceeded,
  failed,
  initialState,
  requirements,
  setTypedName,
  setValue,
  statusChecked,
  tick,
} from "@/lib/copilot/approval";

const T0 = Date.parse("2026-10-22T08:01:00.000Z"); // inside the fixture TTL (08:00 - 08:10)
const AFTER = Date.parse("2026-10-22T08:11:00.000Z");

const tier1: Proposal = proposedSetEnv;
const tier2: Proposal = proposedResize;
const withUserValue: Proposal = {
  ...proposedSetEnv,
  params: { type: "set_env", app: "broken-shop", changes: [{ op: "set", key: "API_TOKEN", valueSource: "user" }, { op: "set", key: "SESSION_SECRET", valueSource: "generated", generator: "hex32" }] },
};
const tier3: Proposal = {
  ...proposedSetEnv,
  type: "delete_app",
  params: { type: "delete_app", app: "broken-shop" },
  source: "user",
};
const fail = (kind: Parameters<typeof failed>[2]["kind"], status: number, code: string, retryAfterSec?: number) => ({ kind, status, code, retryAfterSec });

describe("requirements (tier rules)", () => {
  it("tier 1: single confirm, no typed name", () => {
    expect(requirements(tier1)).toMatchObject({ tier: 1, typedName: false, billed: false, humanOnly: false, userKeys: [] });
  });
  it("tier 2: typed name + cost line", () => {
    expect(requirements(tier2)).toMatchObject({ tier: 2, typedName: true, billed: true });
    expect(requirements(proposedDeployPlan)).toMatchObject({ tier: 2, typedName: true, billed: true, userKeys: ["SMTP_PASSWORD"] });
  });
  it("tier 3 and non-proposable agent actions are human-only", () => {
    expect(requirements(tier3).humanOnly).toBe(true);
    expect(requirements({ ...tier3, source: "agent" }).humanOnly).toBe(true);
    expect(requirements({ ...tier1, type: "create_app", params: { type: "create_app", name: "x", platform: "node", planId: "p" }, source: "agent" }).humanOnly).toBe(true);
  });
  it("collects the env keys the user must type", () => {
    expect(requirements(withUserValue).userKeys).toEqual(["API_TOKEN"]);
  });
});

describe("initial phase", () => {
  it("review for a fresh proposal, blocked for human-only, expired by clock or status", () => {
    expect(initialState(tier1, T0).phase).toBe("review");
    expect(initialState(tier3, T0)).toMatchObject({ phase: "blocked", blockedReason: "human_only" });
    expect(initialState(tier1, AFTER).phase).toBe("expired");
    expect(initialState(proposalFixtures.expired, T0).phase).toBe("expired");
    expect(initialState(proposalFixtures.stale, T0).phase).toBe("stale");
    expect(initialState(proposalFixtures.rejected, T0).phase).toBe("rejected");
    expect(initialState(proposalFixtures.executing, T0)).toMatchObject({ phase: "blocked", blockedReason: "status", blockedStatus: "executing" });
  });
});

describe("confirm gating", () => {
  it("tier 1 can confirm immediately", () => {
    expect(canConfirm(initialState(tier1, T0), tier1, T0)).toBe(true);
  });
  it("tier 2 needs the exact resource name (whitespace from paste is tolerated)", () => {
    let s = initialState(tier2, T0);
    expect(canConfirm(s, tier2, T0)).toBe(false);
    s = setTypedName(s, "broken-sho");
    expect(canConfirm(s, tier2, T0)).toBe(false);
    s = setTypedName(s, "BROKEN-SHOP");
    expect(canConfirm(s, tier2, T0)).toBe(false);
    s = setTypedName(s, " broken-shop ");
    expect(canConfirm(s, tier2, T0)).toBe(true);
  });
  it("user-sourced env values must all be non-empty", () => {
    let s = initialState(withUserValue, T0);
    expect(canConfirm(s, withUserValue, T0)).toBe(false);
    s = setValue(s, "API_TOKEN", "x");
    expect(canConfirm(s, withUserValue, T0)).toBe(true);
  });
  it("cannot confirm human-only or expired proposals", () => {
    expect(canConfirm(initialState(tier3, T0), tier3, T0)).toBe(false);
    expect(canConfirm(initialState(tier1, T0), tier1, AFTER)).toBe(false);
  });
  it("tick moves a review dialog to expired when the TTL passes and wipes values", () => {
    const s = setValue(initialState(withUserValue, T0), "API_TOKEN", "secret");
    expect(tick(s, withUserValue, T0)).toBe(s);
    const e = tick(s, withUserValue, AFTER);
    expect(e.phase).toBe("expired");
    expect(e.values).toEqual({});
  });
});

describe("submit: double click safety and secret hygiene", () => {
  it("clears typed values from state at submit and hands them over once", () => {
    let s = initialState(withUserValue, T0);
    s = setValue(s, "API_TOKEN", "s3cret-value");
    const begun = beginSubmit(s, withUserValue, T0);
    expect(begun).not.toBeNull();
    expect(begun!.payload.userValues).toEqual({ API_TOKEN: "s3cret-value" });
    expect(begun!.state.values).toEqual({});
    expect(JSON.stringify(begun!.state)).not.toContain("s3cret-value");
    expect(begun!.state.phase).toBe("approving");
    // a second click (or Enter) while approving is a no-op
    expect(beginSubmit(begun!.state, withUserValue, T0)).toBeNull();
  });
  it("sends the target name as the typed name only when required", () => {
    const s2 = setTypedName(initialState(tier2, T0), "broken-shop");
    expect(beginSubmit(s2, tier2, T0)!.payload.typedName).toBe("broken-shop");
    expect(beginSubmit(initialState(tier1, T0), tier1, T0)!.payload.typedName).toBeUndefined();
  });
  it("walks approving -> executing -> submitted and ignores out-of-phase events", () => {
    let s = beginSubmit(initialState(tier1, T0), tier1, T0)!.state;
    expect(executeSucceeded(s)).toBe(s);
    s = approveSucceeded(s);
    expect(s.phase).toBe("executing");
    s = executeSucceeded(s);
    expect(s.phase).toBe("submitted");
    expect(approveSucceeded(s)).toBe(s);
  });
  it("values never survive a failure", () => {
    const s = setValue(initialState(withUserValue, T0), "API_TOKEN", "x");
    const begun = beginSubmit(s, withUserValue, T0)!;
    expect(failed(begun.state, "approve", fail("server", 500, "x")).values).toEqual({});
  });
});

describe("failure transitions", () => {
  const base = beginSubmit(initialState(tier1, T0), tier1, T0)!.state;
  it("stale / expired from the server", () => {
    expect(failed(base, "approve", fail("conflict", 409, "proposal.stale")).phase).toBe("stale");
    expect(failed(base, "approve", fail("generic", 410, "proposal.expired")).phase).toBe("expired");
    expect(failed(base, "execute", fail("generic", 410, "gone")).phase).toBe("expired");
  });
  it("conflict, auth, rate limit", () => {
    expect(failed(base, "approve", fail("conflict", 409, "busy")).phase).toBe("conflict");
    expect(failed(base, "approve", fail("unauthorized", 401, "x")).phase).toBe("unauthorized");
    expect(failed(base, "approve", fail("forbidden", 403, "x")).phase).toBe("forbidden");
    expect(failed(base, "approve", fail("rateLimited", 429, "x", 9))).toMatchObject({ phase: "rate_limited", retryAfterSec: 9 });
  });
  it("a bad typed name keeps the dialog usable", () => {
    expect(failed(base, "approve", fail("invalid", 400, "typed_name_mismatch"))).toMatchObject({ phase: "error", errorReason: "bad_name" });
  });
  it("a lost execute response is an unknown result (never auto-retried); a lost approve response is a plain error", () => {
    expect(failed(base, "execute", fail("network", 0, "network")).phase).toBe("unknown_result");
    expect(failed(base, "execute", fail("server", 502, "bad")).phase).toBe("unknown_result");
    expect(failed(base, "approve", fail("network", 0, "network"))).toMatchObject({ phase: "error", errorReason: "network" });
  });
  it("checking the status after an unknown result", () => {
    const unknown = failed(base, "execute", fail("network", 0, "network"));
    expect(statusChecked(unknown, "executing").phase).toBe("submitted");
    expect(statusChecked(unknown, "verified").phase).toBe("submitted");
    expect(statusChecked(unknown, "approved")).toMatchObject({ phase: "review", notStarted: true });
    expect(statusChecked(unknown, "stale").phase).toBe("stale");
    expect(statusChecked(unknown, "expired").phase).toBe("expired");
    expect(statusChecked(base, "executing")).toBe(base);
  });
  it("resize params fixture is typed correctly (sanity)", () => {
    expect(fixtureResizeParams.type).toBe("resize");
  });
});
