// Event bus + SSE: contract-only frames, replay for late subscribers, terminal end, Last-Event-ID resume.
import { describe, expect, it } from "vitest";
import { publish, publishExecution, publishProposal, subscribe } from "../../../lib/actions/events";
import { handleApprove, handleEvents, handleExecute } from "../../../lib/actions/http/proposals";
import { MAX_STREAMS_PER_ACCOUNT } from "../../../lib/actions/http/sse";
import { casTransition } from "../../../lib/security/state-machine";
import { CopilotStreamEventSchema, type CopilotDataStreamEvent } from "../../../lib/contracts/stream";
import type { Proposal } from "../../../lib/contracts/proposal";
import { body, ctxFor, newAccount, propose, setup, type TestEnv } from "./helpers";

interface Frame {
  id?: number;
  event: CopilotDataStreamEvent;
}

function parseFrames(text: string): Frame[] {
  const frames: Frame[] = [];
  for (const block of text.split("\n\n")) {
    const data = block.split("\n").find((l) => l.startsWith("data: "));
    if (!data) continue;
    const id = block.split("\n").find((l) => l.startsWith("id: "));
    const parsed = CopilotStreamEventSchema.safeParse(JSON.parse(data.slice(6)));
    expect(parsed.success).toBe(true);
    frames.push({ ...(id ? { id: Number(id.slice(4)) } : {}), event: parsed.data as CopilotDataStreamEvent });
  }
  return frames;
}

async function runRestart(env: TestEnv): Promise<Proposal> {
  env.liara.addApp("shop");
  const p = await propose(env, { type: "restart", app: "shop" });
  const { approvalToken } = await body<{ approvalToken: string }>(await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps));
  expect((await handleExecute(ctxFor(env, { body: { approvalToken } }), p.id, env.deps)).status).toBe(202);
  await env.settle();
  return p;
}

describe("bus", () => {
  it("replays the latest event per part id, drops off-contract events, stops after terminal", () => {
    const acc = newAccount();
    publishExecution(acc, "p_bus1", "restart", "running");
    publishExecution(acc, "p_bus1", "restart", "done");
    publishExecution(acc, "p_bus1", "not a valid step!", "done");
    publish(acc, "p_bus1", { type: "data-error", id: "e", data: { code: "Bad Code", messageFa: "x" } });
    const seen: string[] = [];
    const sub = subscribe(acc, "p_bus1", (e) => seen.push(e.event.type));
    expect(sub.replay.map((e) => (e.event.type === "data-execution" ? e.event.data.status : e.event.type))).toEqual(["done"]);
    publish(acc, "p_bus1", { type: "data-error", id: "err", data: { code: "internal", messageFa: "خطا" } }, { terminal: true });
    publishExecution(acc, "p_bus1", "late", "done");
    expect(seen).toEqual(["data-error"]);
    expect(subscribe(acc, "p_bus1", () => undefined).terminal).toBe(true);
    sub.unsubscribe();
  });

  it("channels are per account", () => {
    const a = newAccount();
    const b = newAccount();
    publishExecution(a, "p_same", "restart", "running");
    expect(subscribe(b, "p_same", () => undefined).replay).toHaveLength(0);
  });
});

describe("GET /api/proposals/{id}/events", () => {
  it("a late subscriber gets the whole run as contract frames and the stream ends on the terminal status", async () => {
    const env = setup();
    const p = await runRestart(env);
    const res = await handleEvents(ctxFor(env, { method: "GET" }), p.id, env.deps);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseFrames(await res.text());
    const types = frames.map((f) => f.event.type);
    expect(types).toContain("data-execution");
    expect(types).toContain("data-verification");
    const last = frames.at(-1)!.event;
    expect(last.type).toBe("data-proposal");
    expect(last.type === "data-proposal" && last.data.status).toBe("verified");
    const ids = frames.map((f) => f.id as number);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
  });

  it("resumes after Last-Event-ID", async () => {
    const env = setup();
    const p = await runRestart(env);
    const all = parseFrames(await (await handleEvents(ctxFor(env, { method: "GET" }), p.id, env.deps)).text());
    const cut = all[2].id as number;
    const rest = parseFrames(await (await handleEvents(ctxFor(env, { method: "GET", headers: { "last-event-id": String(cut) } }), p.id, env.deps)).text());
    expect(rest.map((f) => f.id)).toEqual(all.filter((f) => (f.id as number) > cut).map((f) => f.id));
  });

  it("a stream opened before execute (setup client order) receives the run live", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const { approvalToken } = await body<{ approvalToken: string }>(await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps));
    const stream = await handleEvents(ctxFor(env, { method: "GET" }), p.id, env.deps, { heartbeatMs: 50 });
    const text = stream.text();
    await handleExecute(ctxFor(env, { body: { approvalToken } }), p.id, env.deps);
    await env.settle();
    const frames = parseFrames(await text);
    expect(frames.some((f) => f.event.type === "data-verification")).toBe(true);
    expect(frames.at(-1)?.event.type).toBe("data-proposal");
  });

  it("a finished proposal with no in-memory history sends its stored status and ends", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    await casTransition(env.store, env.accountId, p.id, ["proposed"], "rejected", env.clock.now());
    const frames = parseFrames(await (await handleEvents(ctxFor(env, { method: "GET" }), p.id, env.deps)).text());
    expect(frames).toHaveLength(1);
    expect(frames[0].event.type === "data-proposal" && frames[0].event.data.status).toBe("rejected");
  });

  it("a proposal that expired after earlier events ends the stream with its expired status", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps);
    env.clock.advance(11 * 60_000);
    const frames = parseFrames(await (await handleEvents(ctxFor(env, { method: "GET" }), p.id, env.deps)).text());
    const last = frames.at(-1)!.event;
    expect(last.type === "data-proposal" && last.data.status).toBe("expired");
  });

  it("other accounts get 404; concurrent streams per account are capped", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    expect((await handleEvents(ctxFor({ ...env, accountId: "acct_peeker" }, { method: "GET" }), p.id, env.deps)).status).toBe(404);
    const aborts: AbortController[] = [];
    const open: Response[] = [];
    for (let i = 0; i < MAX_STREAMS_PER_ACCOUNT; i++) {
      const ac = new AbortController();
      aborts.push(ac);
      const ctx = ctxFor(env, { method: "GET" });
      open.push(await handleEvents({ ...ctx, request: new Request(ctx.request, { signal: ac.signal }) }, p.id, env.deps));
    }
    expect(open.every((r) => r.status === 200)).toBe(true);
    expect((await handleEvents(ctxFor(env, { method: "GET" }), p.id, env.deps)).status).toBe(429);
    aborts.forEach((a) => a.abort());
    await Promise.all(open.map((r) => r.body?.cancel()));
    publishProposal(env.accountId, (await env.store.proposals.get(env.accountId, p.id)) as Proposal, true);
    expect((await handleEvents(ctxFor(env, { method: "GET" }), p.id, env.deps)).status).toBe(200);
  });
});
