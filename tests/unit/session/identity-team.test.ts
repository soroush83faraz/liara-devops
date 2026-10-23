// Connect path: the account id must differ between the personal account and every team, so caches, proposals,
// layouts and per-account browser state never mix; the personal id stays exactly what it was before team support.
// Body shape: tests/fixtures/recorded/team-billing-2026-10-23.json (recorded live 2026-10-23, anonymised).
import { describe, expect, it } from "vitest";
import { deriveIdentity, hashAccountId } from "../../../app/api/session/identity";
import { sessionPublicView } from "../../../lib/session";
import fx from "../../fixtures/recorded/team-billing-2026-10-23.json";

const meTeam = fx.meTeamMode;
const mePersonal = { ...meTeam, team: undefined };

describe("deriveIdentity with a team id", () => {
  it("personal id is unchanged (hash of the user id), team ids differ from it and from each other", () => {
    const personal = deriveIdentity(mePersonal);
    expect(personal?.accountId).toBe(hashAccountId("synth-user-0001"));
    const a = deriveIdentity(meTeam, "SYNTH-TEAM-0001");
    const b = deriveIdentity(meTeam, "SYNTH-TEAM-0002");
    expect(new Set([personal?.accountId, a?.accountId, b?.accountId]).size).toBe(3);
    expect(deriveIdentity(meTeam, "SYNTH-TEAM-0001")?.accountId).toBe(a?.accountId); // stable
    expect(deriveIdentity(meTeam, undefined)?.accountId).toBe(personal?.accountId);
  });

  it("team mode exposes the team name and the person's role; personal mode never does", () => {
    expect(deriveIdentity(meTeam, "SYNTH-TEAM-0001")).toMatchObject({ teamName: "SYNTHETIC Team", teamMemberRole: "SYNTH_ROLE" });
    const p = deriveIdentity(meTeam);
    expect(p?.teamName).toBeUndefined();
    expect(p?.teamMemberRole).toBeUndefined();
  });

  it("a team id with no team object still connects (balance handling reports it later) without a team name", () => {
    const id = deriveIdentity(mePersonal, "SYNTH-TEAM-0001");
    expect(id?.teamName).toBeUndefined();
    expect(id?.accountId).not.toBe(deriveIdentity(mePersonal)?.accountId);
  });

  it("team ids that differ only by case get different account ids (the session keeps the raw case)", () => {
    expect(deriveIdentity(meTeam, "AbCd1")?.accountId).not.toBe(deriveIdentity(meTeam, "abcd1")?.accountId);
  });

  it("the team id and names never leak into the id", () => {
    const out = deriveIdentity(meTeam, "SYNTH-TEAM-0001")?.accountId ?? "";
    expect(out).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("sessionPublicView in team mode", () => {
  it("includes teamName/role only with a team id; never a token", () => {
    const v = sessionPublicView({ accountId: "x", teamId: "T1", userName: "U", teamName: "SYNTHETIC Team", teamMemberRole: "SYNTH_ROLE" });
    expect(v).toMatchObject({ teamId: "T1", teamName: "SYNTHETIC Team", teamMemberRole: "SYNTH_ROLE" });
    const personal = sessionPublicView({ accountId: "x", userName: "U", teamName: "stale", teamMemberRole: "stale" });
    expect(personal).toEqual({ connected: true, accountId: "x", userName: "U" });
  });
});
