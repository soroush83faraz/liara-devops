import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SAFE_ID_RE } from "../../../lib/contracts/common";
import { PROPOSAL_STATUSES, ProposalSchema, type Proposal, type ProposalStatus } from "../../../lib/contracts/proposal";
import { hashParams } from "../../../lib/security/canonical";
import {
  PROPOSAL_TRANSITIONS,
  ProposalStateError,
  assertProposalIntegrity,
  canTransition,
  casTransition,
  claimExecution,
  createProposal,
  expireIfDue,
  isExpired,
  isTerminal,
  makeIdempotencyKey,
  transition,
  type CreateProposalInput,
} from "../../../lib/security/state-machine";
import { createFileStore, createMemoryStore, type Store } from "../../../lib/security/store";
import { HEX64, SAMPLE_PARAMS } from "../contracts/samples";

const LEGAL = new Set([
  "proposed->approved",
  "proposed->rejected",
  "proposed->expired",
  "proposed->stale",
  "approved->executing",
  "approved->rejected",
  "approved->expired",
  "approved->stale",
  "executing->verifying",
  "executing->failed",
  "verifying->verified",
  "verifying->not_verified",
  "verifying->failed",
]);
const TERMINAL: ProposalStatus[] = ["verified", "not_verified", "failed", "rejected", "expired", "stale"];

const T0 = Date.parse("2026-10-22T08:00:00.000Z");
const ACCOUNT = "acct_sm";

const baseInput: CreateProposalInput = {
  accountId: ACCOUNT,
  params: SAMPLE_PARAMS.restart,
  source: "agent",
  rationaleFa: "دلیل",
  evidenceIds: ["O1"],
  effectFa: "اثر",
  risksFa: [],
  verificationPlan: ["probe_2xx"],
  stateFingerprint: HEX64,
};

const make = (status: ProposalStatus = "proposed", now = T0): Proposal => ({ ...createProposal(baseInput, now), status });

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe("transition table", () => {
  it("allows exactly the plan's edges for every pair of states", () => {
    let pairs = 0;
    for (const from of PROPOSAL_STATUSES) {
      for (const to of PROPOSAL_STATUSES) {
        pairs++;
        const legal = LEGAL.has(`${from}->${to}`);
        expect(canTransition(from, to), `${from}->${to}`).toBe(legal);
        const p = deepFreeze(make(from));
        if (legal) {
          const next = transition(p, to, T0 + 1000);
          expect(next.status).toBe(to);
          expect(next).not.toBe(p);
          expect(p.status).toBe(from); // input untouched
          expect(ProposalSchema.safeParse(next).success).toBe(true);
        } else {
          expect(() => transition(p, to, T0 + 1000), `${from}->${to}`).toThrow(ProposalStateError);
        }
      }
    }
    expect(pairs).toBe(100);
  });

  it("terminal states are immutable", () => {
    for (const s of TERMINAL) {
      expect(isTerminal(s)).toBe(true);
      expect(PROPOSAL_TRANSITIONS[s]).toHaveLength(0);
      for (const to of PROPOSAL_STATUSES) expect(() => transition(make(s), to, T0)).toThrow(ProposalStateError);
    }
    for (const s of ["proposed", "approved", "executing", "verifying"] as const) expect(isTerminal(s)).toBe(false);
    expect(Object.isFrozen(PROPOSAL_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(PROPOSAL_TRANSITIONS.proposed)).toBe(true);
  });

  it("rejects unknown states", () => {
    expect(canTransition("hacked" as ProposalStatus, "approved")).toBe(false);
    expect(canTransition("proposed", "hacked" as ProposalStatus)).toBe(false);
    expect(canTransition("__proto__" as ProposalStatus, "approved")).toBe(false);
  });

  it("an expired proposal can be neither approved nor executed, only expired", () => {
    const p = make("proposed");
    const late = Date.parse(p.expiresAt);
    expect(isExpired(p, late - 1)).toBe(false);
    expect(isExpired(p, late)).toBe(true);
    expect(isExpired({ expiresAt: "garbage" }, T0)).toBe(true);
    expect(() => transition(p, "approved", late)).toThrow(/expired/);
    expect(() => transition(make("approved"), "executing", late)).toThrow(/expired/);
    expect(transition(p, "expired", late).status).toBe("expired");
  });

  it("keeps history bounded and ordered", () => {
    let p = make("proposed");
    p = transition(p, "approved", T0 + 1);
    p = transition(p, "executing", T0 + 2);
    p = transition(p, "verifying", T0 + 3);
    p = transition(p, "verified", T0 + 4);
    expect(p.history?.map((h) => h.status)).toEqual(["proposed", "approved", "executing", "verifying", "verified"]);
    const long = { ...make("proposed"), history: Array.from({ length: 20 }, () => ({ status: "proposed" as const, at: p.createdAt })) };
    expect(transition(long, "rejected", T0).history).toHaveLength(20);
  });
});

describe("createProposal / integrity", () => {
  it("computes every derived field itself", () => {
    const p = createProposal(baseInput, T0);
    expect(p.status).toBe("proposed");
    expect(p.target).toEqual({ kind: "app", name: "shop" });
    expect(p.paramsHash).toBe(hashParams(SAMPLE_PARAMS.restart));
    expect(p.reversible).toBe("yes");
    expect(Date.parse(p.expiresAt) - T0).toBe(10 * 60_000);
    expect(p.id).toMatch(SAFE_ID_RE);
    expect(p.idempotencyKey).toMatch(/^idk_[0-9a-f]{40}$/);
    expect(p.idempotencyKey).toMatch(SAFE_ID_RE);
  });

  it("refuses assistant deletes/creations and uncited assistant proposals", () => {
    for (const t of ["delete_app", "delete_db", "delete_domain", "delete_disk", "create_app", "create_db", "create_network"] as const) {
      expect(() => createProposal({ ...baseInput, params: SAMPLE_PARAMS[t] }, T0), t).toThrow();
    }
    expect(() => createProposal({ ...baseInput, evidenceIds: [] }, T0)).toThrow();
    expect(() => createProposal({ ...baseInput, params: SAMPLE_PARAMS.resize }, T0)).toThrow(); // billed without cost
    expect(() => createProposal({ ...baseInput, ttlMs: 2 * 3600_000 }, T0)).toThrow(RangeError);
    expect(createProposal({ ...baseInput, source: "user", evidenceIds: [], params: SAMPLE_PARAMS.delete_app }, T0).type).toBe("delete_app");
  });

  it("ids are unique", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createProposal(baseInput, T0).id));
    expect(ids.size).toBe(500);
  });

  it("detects params tampered after hashing", () => {
    const p = createProposal(baseInput, T0);
    expect(assertProposalIntegrity(p)).toEqual(p);
    const tampered = { ...p, params: { type: "restart", app: "victim" }, target: { kind: "app", name: "victim" } };
    expect(() => assertProposalIntegrity(tampered)).toThrow(ProposalStateError);
    expect(() => assertProposalIntegrity({ ...p, source: "agent", type: "delete_app" })).toThrow(ProposalStateError);
    expect(() => assertProposalIntegrity("not a proposal")).toThrow(ProposalStateError);
  });

  it("idempotency keys are deterministic per input", () => {
    const input = { accountId: "a", proposalId: "p1", type: "restart" as const, paramsHash: HEX64 };
    expect(makeIdempotencyKey(input)).toBe(makeIdempotencyKey({ ...input }));
    expect(makeIdempotencyKey(input)).not.toBe(makeIdempotencyKey({ ...input, proposalId: "p2" }));
  });
});

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const stores: Array<[string, () => Promise<Store>]> = [
  ["memory", async () => createMemoryStore()],
  [
    "file",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "hamyar-sm-"));
      tmpDirs.push(dir);
      return createFileStore(dir);
    },
  ],
];

describe.each(stores)("claimExecution (%s store)", (_name, makeStore) => {
  it("exactly one of many concurrent claims wins", async () => {
    const store = await makeStore();
    const p = transition(createProposal(baseInput, T0), "approved", T0 + 1);
    await store.proposals.put(ACCOUNT, p.id, p);
    const results = await Promise.all(Array.from({ length: 40 }, () => claimExecution(store, ACCOUNT, p.id, T0 + 2)));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    for (const r of results) if (!r.claimed) expect(r).toMatchObject({ reason: "not_approved", status: "executing" });
    expect((await store.proposals.get(ACCOUNT, p.id))?.status).toBe("executing");
  });

  it("refuses unapproved, missing and expired proposals", async () => {
    const store = await makeStore();
    const proposed = createProposal(baseInput, T0);
    await store.proposals.put(ACCOUNT, proposed.id, proposed);
    expect(await claimExecution(store, ACCOUNT, proposed.id, T0 + 1)).toMatchObject({ claimed: false, reason: "not_approved" });
    expect(await claimExecution(store, ACCOUNT, "p_missing", T0 + 1)).toMatchObject({ claimed: false, reason: "not_found" });
    expect(await claimExecution(store, "other_account", proposed.id, T0 + 1)).toMatchObject({ claimed: false, reason: "not_found" });

    const approved = transition(createProposal(baseInput, T0), "approved", T0 + 1);
    await store.proposals.put(ACCOUNT, approved.id, approved);
    const late = Date.parse(approved.expiresAt);
    expect(await claimExecution(store, ACCOUNT, approved.id, late)).toMatchObject({ claimed: false, reason: "expired" });
    expect((await store.proposals.get(ACCOUNT, approved.id))?.status).toBe("expired");
  });

  it("concurrent approvals of one proposal: exactly one succeeds", async () => {
    const store = await makeStore();
    const p = createProposal(baseInput, T0);
    await store.proposals.put(ACCOUNT, p.id, p);
    const results = await Promise.all(Array.from({ length: 20 }, () => casTransition(store, ACCOUNT, p.id, ["proposed"], "approved", T0 + 5)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("expireIfDue only expires live proposals past their TTL", async () => {
    const store = await makeStore();
    const p = createProposal(baseInput, T0);
    await store.proposals.put(ACCOUNT, p.id, p);
    expect((await expireIfDue(store, ACCOUNT, p.id, T0 + 1))?.status).toBe("proposed");
    expect((await expireIfDue(store, ACCOUNT, p.id, Date.parse(p.expiresAt)))?.status).toBe("expired");
  });
});
