// Team-aware account/billing normalisers. Shapes: tests/fixtures/recorded/team-billing-2026-10-23.json (recorded
// from a read-only live spike on 2026-10-23, anonymised): with ?teamID= both /v1/billing and /v1/me return `user`
// (the person) AND `team` (the money), and the balance that matters is team.balance.
import { describe, expect, it } from "vitest";
import { BillingSchema, MeSchema, normalizeAccount, normalizeBilling } from "../../../lib/liara";
import { normalizePlans } from "../../../lib/create/plans";
import { balanceGate } from "../../../lib/create/cost";
import fx from "../../fixtures/recorded/team-billing-2026-10-23.json";

const TEAM = "SYNTH-TEAM-0001";
const billingTeam = BillingSchema.parse(fx.billingTeamMode);
const billingPersonal = BillingSchema.parse({ user: fx.billingTeamMode.user });
const meTeam = MeSchema.parse(fx.meTeamMode);
const mePersonal = MeSchema.parse({ ...fx.meTeamMode, team: undefined });

describe("normalizeBilling", () => {
  it("personal mode: uses user.balance and says so", () => {
    const b = normalizeBilling(billingPersonal, undefined);
    expect(b).toMatchObject({ source: "user", balance: 0.5999999999767169, accountType: "REAL_PERSON", minCreditAmount: 20000, teamUnreadable: false });
  });

  it("personal mode ignores a team object even when the response carries one", () => {
    expect(normalizeBilling(billingTeam, undefined)).toMatchObject({ source: "user", balance: 0.5999999999767169 });
  });

  it("team mode: uses team.balance (2,000,000), NOT the person's 0.6", () => {
    const b = normalizeBilling(billingTeam, TEAM);
    expect(b).toMatchObject({ source: "team", balance: 2000000, minCreditAmount: 20000, isManualMinCredit: false, belowMinCredit: false, teamUnreadable: false });
  });

  it("team id given but no team object: balance UNKNOWN, never the personal balance", () => {
    const b = normalizeBilling(billingPersonal, TEAM);
    expect(b.source).toBe("team");
    expect(b.balance).toBeUndefined();
    expect(b.teamUnreadable).toBe(true);
    expect(JSON.stringify(b)).not.toContain("0.59");
  });

  it("a team object without a numeric balance is unknown too", () => {
    const b = normalizeBilling(BillingSchema.parse({ user: { balance: 5 }, team: { balance: "2000000" } }), TEAM);
    expect(b).toMatchObject({ source: "team", teamUnreadable: true });
    expect(b.balance).toBeUndefined();
  });

  it("balance below the min credit is flagged as data (team and personal)", () => {
    expect(normalizeBilling(billingPersonal, undefined).belowMinCredit).toBe(true); // 0.6 < 20000
    const lowTeam = BillingSchema.parse({ user: { balance: 9e6 }, team: { balance: 19999, minCreditAmount: 20000 } });
    expect(normalizeBilling(lowTeam, TEAM)).toMatchObject({ source: "team", balance: 19999, belowMinCredit: true });
    expect(normalizeBilling(BillingSchema.parse({ team: { balance: 20000, minCreditAmount: 20000 } }), TEAM).belowMinCredit).toBe(false);
  });
});

describe("normalizeAccount", () => {
  it("team mode: team name, the person's role, permissions as data, flags and min credit from `team`", () => {
    const a = normalizeAccount(meTeam, TEAM);
    expect(a).toMatchObject({
      source: "team",
      teamId: "SYNTH-TEAM-0001",
      teamName: "SYNTHETIC Team",
      teamMemberRole: "SYNTH_ROLE",
      teamMemberPermissions: ["SYNTH_PERMISSION"],
      privateNetworkFeature: true,
      legacyNetworkFeature: false,
      minCreditAmount: 20000,
      teamUnreadable: false,
    });
  });

  it("personal mode: no team fields, flags from user", () => {
    const a = normalizeAccount(MeSchema.parse({ user: { privateNetworkFeature: false, legacyNetworkFeature: true } }), undefined);
    expect(a).toEqual({ source: "user", privateNetworkFeature: false, legacyNetworkFeature: true, teamUnreadable: false });
  });

  it("team id given but no team object: nothing team-specific, flagged unreadable (no fallback to user flags)", () => {
    const a = normalizeAccount(MeSchema.parse({ user: { privateNetworkFeature: true } }), TEAM);
    expect(a).toEqual({ source: "team", teamUnreadable: true });
    expect(normalizeAccount(mePersonal, TEAM).teamUnreadable).toBe(true);
  });
});

describe("create wizard plans (normalizePlans)", () => {
  it("network flags come from `team` in team mode and carry the unreadable-balance marker", () => {
    const teamMe = MeSchema.parse({ ...fx.meTeamMode, user: { privateNetworkFeature: false }, team: { ...fx.meTeamMode.team, privateNetworkFeature: true } });
    expect(normalizePlans({ me: teamMe, teamId: TEAM, balanceToman: 2000000 }).flags.privateNetworkFeature).toBe(true);
    expect(normalizePlans({ me: teamMe }).flags.privateNetworkFeature).toBe(false);
    const out = normalizePlans({ me: mePersonal, teamId: TEAM, balanceUnreadable: true });
    expect(out.balanceUnreadable).toBe(true);
    expect(out.partial).toContain("balance");
    expect(out.flags).toEqual({});
  });

  it("balanceGate: unreadable team balance blocks a priced resource but not a free one", () => {
    expect(balanceGate(undefined, 100, true)).toEqual({ status: "team_unreadable" });
    expect(balanceGate(undefined, 0, true)).toEqual({ status: "unknown" });
    expect(balanceGate(2000000, 100, false)).toEqual({ status: "ok", balance: 2000000 });
  });
});
