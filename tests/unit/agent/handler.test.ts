import { describe, expect, it } from "vitest";
import { handleAgentPost, AGENT_RATE_LIMIT } from "@/lib/agent/handler";
import { acquireRun, runningCount } from "@/lib/agent/run-limits";
import { MAX_BODY_BYTES } from "@/lib/agent/request";
import { createMemoryIncidentSink } from "@/lib/agent/incident-port";
import { createMemoryStore } from "@/lib/security/store";
import { agentLiara, fakeProbe, loadScenario, nowOf, parseSse, TEST_TOKEN } from "./helpers";

let seq = 0;
const account = () => `acct_http_${Date.now()}_${++seq}`;

function post(body: unknown, init: { signal?: AbortSignal; raw?: string } = {}) {
  return new Request("http://localhost:3000/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: init.raw ?? JSON.stringify(body),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

const userMsg = (text: string) => ({ id: "m1", role: "user", parts: [{ type: "text", text }] });

function call(accountId: string, req: Request) {
  const s = loadScenario("missing-env");
  const backend = agentLiara(s);
  return handleAgentPost(
    { session: { accountId, token: TEST_TOKEN }, liara: backend.client, request: req },
    { models: null, store: createMemoryStore(), incidents: createMemoryIncidentSink(), probe: fakeProbe(s), now: nowOf(s) },
  );
}

describe("POST /api/agent handler", () => {
  it("streams SSE: start, typed data parts, answer text, finish; no token in the body", async () => {
    const acct = account();
    const res = await call(acct, post({ messages: [userMsg("چرا سایت خطای ۵۰۰ می‌دهد؟")], target: { kind: "app", name: "demo-shop" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    const chunks = parseSse(body);
    expect(chunks[0]).toMatchObject({ type: "start" });
    expect(chunks[chunks.length - 1]).toMatchObject({ type: "finish" });
    const types = new Set(chunks.map((c) => c.type));
    for (const t of ["data-step", "data-observation", "data-finding", "data-proposal", "data-incident", "data-error", "text-delta"]) expect(types.has(t), t).toBe(true);
    expect(body).not.toContain(TEST_TOKEN);
    expect(runningCount(acct)).toBe(0);
  });

  it.each([
    ["not json", undefined, "{nope"],
    ["oversized body", undefined, `{"messages":[],"pad":"${"x".repeat(MAX_BODY_BYTES)}"}`],
    ["no messages", { messages: [] }, undefined],
    ["too many messages", { messages: Array.from({ length: 21 }, () => userMsg("x")) }, undefined],
    ["text part too long", { messages: [userMsg("x".repeat(4001))] }, undefined],
    ["last message not from the user", { messages: [{ id: "a", role: "assistant", parts: [{ type: "text", text: "hi" }] }] }, undefined],
    ["invalid target name", { messages: [userMsg("وضعیت")], target: { kind: "app", name: "../etc" } }, undefined],
  ])("400 before streaming: %s", async (_label, body, raw) => {
    const res = await call(account(), post(body, raw ? { raw } : {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it(`rate limit: ${AGENT_RATE_LIMIT.limit} per minute per account, then 429 with retryAfterSec`, async () => {
    const acct = account();
    for (let i = 0; i < AGENT_RATE_LIMIT.limit; i++) expect((await call(acct, post({}))).status).toBe(400);
    const res = await call(acct, post({}));
    expect(res.status).toBe(429);
    const j = await res.json();
    expect(j.error.code).toBe("rate_limited");
    expect(j.error.retryAfterSec).toBeGreaterThan(0);
  });

  it("concurrency cap: at most 2 runs in flight per account", async () => {
    const acct = account();
    const a = acquireRun(acct)!;
    const b = acquireRun(acct)!;
    const res = await call(acct, post({ messages: [userMsg("وضعیت")] }));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("too_many_runs");
    a();
    b();
    expect(runningCount(acct)).toBe(0);
  });

  it("abort propagates: an aborted request stops the run, reports no internal error and frees the slot", async () => {
    const acct = account();
    const ctl = new AbortController();
    ctl.abort();
    const res = await call(acct, post({ messages: [userMsg("چرا سایت خطا می‌دهد؟")], target: { kind: "app", name: "demo-shop" } }, { signal: ctl.signal }));
    const chunks = parseSse(await res.text());
    expect(chunks.some((c) => c.type === "data-finding")).toBe(false);
    expect(chunks.some((c) => c.type === "data-error" && (c.data as { code: string }).code === "internal")).toBe(false);
    expect(runningCount(acct)).toBe(0);
  });
});
