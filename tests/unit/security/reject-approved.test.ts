// S8 regression: an APPROVED proposal could not be rejected (approved -> rejected was not a legal transition), so a
// user who changed their mind after approving was stuck with a live approval token. Now reject works from
// `approved`, is terminal, and every token minted before it fails closed at execute.
import { describe, expect, it } from "vitest";
import { handleApprove, handleExecute, handleReject } from "@/lib/actions/http/proposals";
import { claimExecution } from "@/lib/security/state-machine";
import { body, ctxFor, propose, setup } from "../actions/helpers";

const restarts = (env: ReturnType<typeof setup>) => env.liara.mutations().filter((c) => c.path.endsWith("/actions/restart")).length;

describe("reject after approve", () => {
  it("rejects an approved proposal and the earlier token can never execute", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const approved = await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps);
    expect(approved.status).toBe(200);
    const { approvalToken } = await body<{ approvalToken: string }>(approved);

    const rej = await handleReject(ctxFor(env, { body: {} }), p.id, env.deps);
    expect(rej.status).toBe(200);
    expect((await body<{ proposal: { status: string } }>(rej)).proposal.status).toBe("rejected");

    const exec = await handleExecute(ctxFor(env, { body: { approvalToken } }), p.id, env.deps);
    expect(exec.status).not.toBe(202);
    expect(exec.status).toBe(409);
    await env.settle();
    expect(restarts(env)).toBe(0);
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("rejected");
    // terminal: cannot be re-approved to mint a fresh token
    expect((await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps)).status).toBe(409);
  });

  it("a tier-2 proposal approved with the typed name can still be rejected", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "redeploy_previous", app: "shop", releaseId: "rel_shop_init" });
    const ok = await handleApprove(ctxFor(env, { body: { typedName: "shop" } }), p.id, env.deps);
    expect(ok.status).toBe(200);
    const { approvalToken } = await body<{ approvalToken: string }>(ok);
    expect((await handleReject(ctxFor(env, { body: {} }), p.id, env.deps)).status).toBe(200);
    expect((await handleExecute(ctxFor(env, { body: { approvalToken } }), p.id, env.deps)).status).not.toBe(202);
    await env.settle();
    expect(env.liara.mutations()).toHaveLength(0);
  });

  it("the execution claim fails closed once the proposal is rejected (race between load and claim)", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    expect((await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps)).status).toBe(200);
    expect((await handleReject(ctxFor(env, { body: {} }), p.id, env.deps)).status).toBe(200);
    expect(await claimExecution(env.store, env.accountId, p.id, env.clock.now())).toMatchObject({ claimed: false, reason: "not_approved", status: "rejected" });
  });

  it("an executing proposal cannot be rejected", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps);
    expect((await claimExecution(env.store, env.accountId, p.id, env.clock.now())).claimed).toBe(true);
    expect((await handleReject(ctxFor(env, { body: {} }), p.id, env.deps)).status).toBe(409);
  });
});
