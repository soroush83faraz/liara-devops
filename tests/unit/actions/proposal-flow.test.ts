// Proposal approval/execution gates. Synthetic data only.
import { describe, expect, it } from "vitest";
import { handleApprove, handleExecute, handleGetProposal, handleReject } from "../../../lib/actions/http/proposals";
import { STUCK_AFTER_MS, executeProposal, tokenAccount } from "../../../lib/actions/proposals";
import { claimExecution } from "../../../lib/security/state-machine";
import { FlowError } from "../../../lib/actions/errors";
import type { Proposal } from "../../../lib/contracts/proposal";
import { hashParams } from "../../../lib/security/canonical";
import { mintApprovalToken } from "../../../lib/security/tokens";
import { SAMPLE_PARAMS } from "../contracts/samples";
import { KEY, body, ctxFor, propose, setup, type TestEnv } from "./helpers";

async function approve(env: TestEnv, p: Proposal, typedName?: string): Promise<string> {
  const res = await handleApprove(ctxFor(env, { body: typedName === undefined ? {} : { typedName } }), p.id, env.deps);
  expect(res.status).toBe(200);
  return (await body<{ approvalToken: string }>(res)).approvalToken;
}

const execute = (env: TestEnv, p: Proposal, approvalToken: unknown, extra: Record<string, unknown> = {}) =>
  handleExecute(ctxFor(env, { body: { approvalToken, ...extra } }), p.id, env.deps);

const restarts = (env: TestEnv) => env.liara.mutations().filter((c) => c.path.endsWith("/actions/restart")).length;

describe("approve -> execute (happy path)", () => {
  it("runs once in the background, verifies, audits as agent-approved-by-user", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const approveRes = await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps);
    const approved = await body<{ approvalToken: string; expiresAt: string; proposal: Proposal }>(approveRes);
    expect(approved.proposal.status).toBe("approved");
    expect(Date.parse(approved.expiresAt)).toBeLessThanOrEqual(Date.parse(p.expiresAt));

    const res = await execute(env, p, approved.approvalToken);
    expect(res.status).toBe(202);
    expect(await body(res)).toEqual({ proposalId: p.id, status: "executing" });
    await env.settle();

    expect(restarts(env)).toBe(1);
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("verified");
    const [last] = await env.store.audit.read(env.accountId, { limit: 1 });
    expect(last).toMatchObject({ actor: "agent-approved-by-user", action: "restart", result: "ok", proposalId: p.id });
    expect(last.detail).toContain("verification:verified");
  });
});

describe("approval token negative matrix (nothing executes, proposal stays approved)", () => {
  type Case = [string, string, (env: TestEnv, p: Proposal, valid: string) => unknown];
  const mint = (p: Proposal, over: Record<string, unknown>, now: number, key: Uint8Array = KEY) =>
    mintApprovalToken({ proposalId: p.id, accountId: "x", targetName: p.target.name, type: p.type, paramsHash: p.paramsHash, ...over }, { key, now }).token;
  const acc = (env: TestEnv) => tokenAccount({ accountId: env.accountId, teamId: env.teamId });
  const cases: Case[] = [
    ["malformed", "malformed", () => "garbage"],
    ["bad signature (other key)", "bad_signature", (env, p) => mint(p, { accountId: acc(env) }, env.clock.now(), Buffer.alloc(32, 9))],
    ["wrong account", "wrong_account", (env, p) => mint(p, { accountId: "acct_someone_else" }, env.clock.now())],
    ["wrong team (personal token, team session)", "wrong_account", (env, p) => mint(p, { accountId: env.accountId }, env.clock.now())],
    ["wrong proposal", "wrong_proposal", (env, p) => mint(p, { accountId: acc(env), proposalId: "p_other" }, env.clock.now())],
    ["wrong target", "wrong_target", (env, p) => mint(p, { accountId: acc(env), targetName: "other-app" }, env.clock.now())],
    ["wrong type", "wrong_type", (env, p) => mint(p, { accountId: acc(env), type: "scale" }, env.clock.now())],
    ["wrong params", "wrong_params", (env, p) => mint(p, { accountId: acc(env), paramsHash: hashParams({ type: "restart", app: "other" }) }, env.clock.now())],
    ["valid token, sanity check", "", (_env, _p, valid) => valid],
  ];

  it.each(cases)("%s -> 403 approval_token_invalid (%s)", async (_name, reason, make) => {
    if (reason === "") {
      const env = setup({ teamId: "team1" });
      env.liara.addApp("shop");
      const p = await propose(env, { type: "restart", app: "shop" });
      expect((await execute(env, p, make(env, p, await approve(env, p)))).status).toBe(202);
      await env.settle();
      return;
    }
    const env = setup({ teamId: "team1" });
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const valid = await approve(env, p);
    const res = await execute(env, p, make(env, p, valid));
    expect(res.status).toBe(403);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("approval_token_invalid");
    expect(env.liara.mutations()).toHaveLength(0);
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("approved");
    const [denied] = await env.store.audit.read(env.accountId, { limit: 1 });
    expect(denied).toMatchObject({ result: "denied", action: "proposal.execute", detail: `rejected_approval ${reason}` });
  });

  it("missing token: 400 at the HTTP layer, approval_token_invalid in the flow", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    await approve(env, p);
    expect((await execute(env, p, "")).status).toBe(400);
    await expect(executeProposal(env.deps, { liara: env.liara.client(), scope: { accountId: env.accountId, teamId: "" } }, p.id, { approvalToken: undefined })).rejects.toMatchObject({
      code: "approval_token_invalid",
    });
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("expired token (proposal still valid) -> 403", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" }, { ttlMs: 60 * 60_000 });
    const token = await approve(env, p);
    env.clock.advance(11 * 60_000);
    const res = await execute(env, p, token);
    expect(res.status).toBe(403);
    expect(env.liara.mutations()).toHaveLength(0);
    expect((await env.store.audit.read(env.accountId, { limit: 1 }))[0].detail).toBe("rejected_approval expired");
  });

  it("replayed token: the nonce is burned durably in the store (verify, not inspect)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const token = await approve(env, p);
    expect((await execute(env, p, token)).status).toBe(202);
    await env.settle();
    // Even if the stored status were reset, the same token can never run again.
    const stored = (await env.store.proposals.get(env.accountId, p.id)) as Proposal;
    await env.store.proposals.put(env.accountId, p.id, { ...stored, status: "approved" });
    const again = await execute(env, p, token);
    expect(again.status).toBe(403);
    expect(restarts(env)).toBe(1);
    expect((await env.store.audit.read(env.accountId, { limit: 1 }))[0].detail).toBe("rejected_approval replayed");
  });

  it("a token minted for another session account cannot be used by this account", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const token = await approve(env, p);
    const other = { ...env, accountId: "acct_intruder" };
    const res = await handleExecute(ctxFor(other, { body: { approvalToken: token } }), p.id, env.deps);
    expect(res.status).toBe(404); // the proposal does not even exist for that account
    expect(env.liara.mutations()).toHaveLength(0);
  });
});

describe("exactly once", () => {
  it("double submit of the same token -> one execution", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const token = await approve(env, p);
    const [a, b] = await Promise.all([execute(env, p, token), execute(env, p, token)]);
    await env.settle();
    expect([a.status, b.status].filter((s) => s === 202)).toHaveLength(1);
    expect([403, 409]).toContain([a.status, b.status].find((s) => s !== 202));
    expect(restarts(env)).toBe(1);
  });

  it("two different valid tokens submitted together -> one execution", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const t1 = await approve(env, p);
    const t2 = await approve(env, p);
    const results = await Promise.all([execute(env, p, t1), execute(env, p, t2)]);
    await env.settle();
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(restarts(env)).toBe(1);
  });
});

describe("stale state", () => {
  it("state changed before approval -> 409 stale, status stale, nothing executed", async () => {
    const env = setup();
    const app = env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    app.envs.push({ key: "NEW_KEY", value: "x" });
    const res = await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps);
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("stale");
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("stale");
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("state changed between approval and execution -> 409 stale at execute", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const token = await approve(env, p);
    env.liara.current.set("shop", "rel_new_deploy");
    const res = await execute(env, p, token);
    expect(res.status).toBe(409);
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("stale");
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("volatile health changes (applet state, status) do not make a fix stale", async () => {
    const env = setup();
    const app = env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    app.status = "CRASHED";
    env.liara.applets.set("shop", [{ name: "shop-pod-a", state: "CrashLoopBackOff", timestamp: new Date().toISOString() }]);
    expect((await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps)).status).toBe(200);
  });

  it("a proposal made in another team context is stale in this one", async () => {
    const env = setup({ teamId: "team-a" });
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" }, { teamId: "team-a" });
    const res = await handleApprove(ctxFor(env, { body: {}, teamId: "team-b" }), p.id, env.deps);
    expect(res.status).toBe(409);
  });

  it("unreadable state -> 503, proposal unchanged (fail closed, not stale)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    env.liara.fault("GET /v1/projects/shop", { status: 500 });
    const res = await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps);
    expect(res.status).toBe(503);
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("proposed");
  });
});

describe("typed name, expiry, reject, policy", () => {
  it("tier 2 requires the exact typed name (trimmed); tier 1 does not", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const resize = await propose(env, { type: "resize", resource: { kind: "app", name: "shop" }, planId: "big-g2" });
    for (const typedName of [undefined, "Shop", "shop2", "sho"]) {
      const res = await handleApprove(ctxFor(env, { body: typedName === undefined ? {} : { typedName } }), resize.id, env.deps);
      expect(res.status).toBe(400);
      expect((await body<{ error: { code: string } }>(res)).error.code).toBe("typed_name_mismatch");
    }
    expect((await env.store.proposals.get(env.accountId, resize.id))?.status).toBe("proposed");
    expect((await handleApprove(ctxFor(env, { body: { typedName: "  shop " } }), resize.id, env.deps)).status).toBe(200);
    const restart = await propose(env, { type: "restart", app: "shop" });
    expect((await handleApprove(ctxFor(env, { body: {} }), restart.id, env.deps)).status).toBe(200);
  });

  it("an expired proposal can be neither approved nor executed", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const token = await approve(env, p);
    env.clock.advance(10 * 60_000 + 1);
    const res = await execute(env, p, token);
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("expired");
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("expired");
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("reject is terminal", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const res = await handleReject(ctxFor(env, {}), p.id, env.deps);
    expect(res.status).toBe(200);
    expect((await body<{ proposal: Proposal }>(res)).proposal.status).toBe("rejected");
    expect((await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps)).status).toBe(409);
  });

  it("tier-3 deletes can never go through a proposal, even user-sourced", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "delete_app", app: "shop" }, { source: "user" });
    const res = await handleApprove(ctxFor(env, { body: { typedName: "shop" } }), p.id, env.deps);
    expect(res.status).toBe(403);
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("the assistant cannot even create a create/delete proposal (contract refuses it)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    await expect(propose(env, { type: "delete_app", app: "shop" }, { source: "agent" })).rejects.toThrow();
    await expect(propose(env, { type: "create_network", name: "net2" }, { source: "agent" })).rejects.toThrow();
  });

  it("an agent-sourced deploy plan that creates resources cannot be approved", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, SAMPLE_PARAMS.deploy_plan, { source: "agent" });
    const res = await handleApprove(ctxFor(env, { body: { typedName: p.target.name } }), p.id, env.deps);
    expect(res.status).toBe(403);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("ai_not_allowed");
  });

  it("a failing after() scheduler does not turn a started execution into an error", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const token = await approve(env, p);
    const jobs: Promise<void>[] = [];
    const deps = {
      ...env.deps,
      schedule: (job: () => Promise<void>) => {
        jobs.push(job());
        throw new Error("after() unavailable");
      },
    };
    const res = await handleExecute(ctxFor(env, { body: { approvalToken: token } }), p.id, deps);
    expect(res.status).toBe(202);
    await Promise.all(jobs);
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("verified");
  });

  it("a tampered stored proposal (params changed, hash kept) fails integrity", async () => {
    const env = setup();
    env.liara.addApp("shop");
    env.liara.addApp("other");
    const p = await propose(env, { type: "restart", app: "shop" });
    await env.store.proposals.put(env.accountId, p.id, { ...p, params: { type: "restart", app: "other" }, target: { kind: "app", name: "other" } });
    const res = await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps);
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("integrity");
  });

  it("an execution interrupted by a restart (no job in this process) is closed as failed and audited", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    await approve(env, p);
    await claimExecution(env.store, env.accountId, p.id, env.clock.now());
    env.clock.advance(STUCK_AFTER_MS + 1);
    const res = await handleGetProposal(ctxFor(env, { method: "GET" }), p.id, env.deps);
    expect((await body<{ proposal: Proposal }>(res)).proposal.status).toBe("failed");
    const [entry] = await env.store.audit.read(env.accountId, { limit: 1 });
    expect(entry).toMatchObject({ actor: "system", action: "proposal.interrupted", result: "error" });
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("FlowError carries no upstream text", () => {
    expect(JSON.stringify(new FlowError("stale"))).not.toMatch(/liara|token/i);
  });
});
