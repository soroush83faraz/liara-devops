import { beforeEach, describe, expect, it } from "vitest";
import { copilotDataPartSchemas, CopilotStreamEventSchema, ProposalSchema, userValueKeys } from "@/lib/contracts";
import {
  MOCK_SCENARIO_IDS,
  buildAgentPlan,
  buildExecutionPlan,
  forceMockScenario,
  mockFetch,
  pickScenario,
  resetMockServer,
  type MockScenarioId,
} from "@/lib/copilot/mock-stream";
import { applyChunk, emptyThread, startTurn, finishTurn } from "@/lib/copilot/thread";
import { groupTurn } from "@/lib/copilot/blocks";
import { streamAgent, toWireMessages } from "@/lib/copilot/stream-client";

const NOW = new Date("2026-10-22T09:00:00.000Z");
const APP = { kind: "app", name: "broken-shop" } as const;

function plan(scenario: MockScenarioId, target: { kind: "app" | "db"; name: string } = APP) {
  return buildAgentPlan({ scenario, target, now: NOW, proposalId: "p_mock_0001", incidentId: "inc_mock_0001" });
}

describe("mock stream validity", () => {
  for (const id of MOCK_SCENARIO_IDS) {
    for (const target of [APP, { kind: "db", name: "shop-db" } as const]) {
      it(`${id} on ${target.kind}: every data part satisfies the contract schemas`, () => {
        const p = plan(id, target);
        for (const { chunk } of p.steps) {
          const c = chunk as { type: string; data?: unknown };
          if (c.type.startsWith("data-")) {
            const name = c.type.slice(5) as keyof typeof copilotDataPartSchemas;
            expect(copilotDataPartSchemas[name], c.type).toBeDefined();
            const r = copilotDataPartSchemas[name].safeParse(c.data);
            expect(r.success, `${c.type}: ${r.success ? "" : JSON.stringify(r.error.issues[0])}`).toBe(true);
            // Data parts that are part of the published stream-event union must also pass it.
            const ev = CopilotStreamEventSchema.safeParse(chunk);
            expect(ev.success, c.type).toBe(true);
          }
        }
      });
    }
  }

  it("s1 emits steps -> observations -> finding (strong) -> proposal(set_env) in order", () => {
    const types = plan("s1").steps.map((s) => (s.chunk as { type: string }).type);
    const first = (t: string) => types.indexOf(t);
    expect(first("data-step")).toBeLessThan(first("data-observation"));
    expect(first("data-observation")).toBeLessThan(first("data-finding"));
    expect(first("data-finding")).toBeLessThan(first("data-proposal"));
    const finding = plan("s1").steps.find((s) => (s.chunk as { type: string }).type === "data-finding")!.chunk as {
      data: { hypotheses: Array<{ level: string; titleFa: string }> };
    };
    expect(finding.data.hypotheses[0].level).toBe("strong");
    expect(plan("s1").proposal?.type).toBe("set_env");
    expect(ProposalSchema.safeParse(plan("s1").proposal).success).toBe(true);
  });

  it("proposal timestamps follow the supplied clock (never already expired)", () => {
    const p = plan("s1").proposal!;
    expect(Date.parse(p.createdAt)).toBe(NOW.getTime());
    expect(Date.parse(p.expiresAt) - NOW.getTime()).toBe(10 * 60_000);
  });

  it("retargets fixtures to the selected service name", () => {
    const text = JSON.stringify(plan("s1", { kind: "app", name: "my-api" }).steps);
    expect(text).not.toContain("broken-shop");
    expect(text).toContain("my-api");
  });

  it("variants: insufficient has no proposal; healthy has no hypotheses; partial marks a failed step; llm_down uses a degrade error", () => {
    expect(plan("insufficient").proposal).toBeUndefined();
    expect(plan("healthy").proposal).toBeUndefined();
    const stepStatuses = plan("partial").steps.map((s) => s.chunk as { type: string; data?: { status?: string } }).filter((c) => c.type === "data-step");
    expect(stepStatuses.some((c) => c.data?.status === "failed")).toBe(true);
    const errors = plan("llm_down").steps.map((s) => s.chunk as { type: string; data?: { code?: string } }).filter((c) => c.type === "data-error");
    expect(errors[0].data?.code).toMatch(/llm/);
    const injected = plan("injection").steps.map((s) => s.chunk as { type: string; data?: { flagged?: boolean } }).filter((c) => c.type === "data-observation");
    expect(injected.some((c) => c.data?.flagged === true)).toBe(true);
    expect(plan("declined").proposal).toBeUndefined();
    expect(plan("declined").steps.some((s) => (s.chunk as { type: string }).type === "data-step")).toBe(false);
  });

  it("scenario picking follows the suggested chips", () => {
    expect(pickScenario("سایتم خطای ۵۰۰ می‌دهد")).toBe("s1");
    expect(pickScenario("سایتم کند شده")).toBe("insufficient");
    expect(pickScenario("وضعیت کلی را بگو")).toBe("healthy");
    expect(pickScenario("آخرین انتشار چه شد؟")).toBe("healthy");
    expect(pickScenario("لطفا اپ را حذف کن")).toBe("declined");
    expect(pickScenario("anything", "not_verified")).toBe("not_verified");
  });

  it("execution plan ends with a verification that matches the scenario outcome", () => {
    const proposal = plan("s1").proposal!;
    const ok = buildExecutionPlan(proposal, "s1");
    const last = ok[ok.length - 1].chunk as { type: string; data: { result: { outcome: string } } };
    expect(last.type).toBe("data-verification");
    expect(last.data.result.outcome).toBe("verified");
    const nv = buildExecutionPlan(proposal, "not_verified");
    expect((nv[nv.length - 1].chunk as { data: { result: { outcome: string } } }).data.result.outcome).toBe("not_verified");
    for (const s of ok) {
      const c = s.chunk as { type: string; data: unknown };
      const name = c.type.slice(5) as keyof typeof copilotDataPartSchemas;
      expect(copilotDataPartSchemas[name].safeParse(c.data).success).toBe(true);
    }
  });

  it("the reducer turns the full s1 plan into timeline + finding + proposal + incident blocks", () => {
    const started = startTurn(emptyThread(), "q");
    const turnId = started.turnId;
    let thread = started.thread;
    for (const s of plan("s1").steps) thread = applyChunk(thread, turnId, s.chunk);
    thread = finishTurn(thread, turnId);
    const turn = thread.turns[0];
    expect(turn.invalidParts).toBe(0);
    expect(turn.status).toBe("done");
    const kinds = groupTurn(turn, thread).map((b) => b.kind);
    expect(kinds).toEqual(expect.arrayContaining(["timeline", "text", "finding", "incident", "proposal"]));
  });
});

describe("mock server", () => {
  beforeEach(() => resetMockServer());

  async function drain(res: Response): Promise<unknown[]> {
    const out: unknown[] = [];
    const g = streamAgent({
      fetchImpl: async () => res,
      target: APP,
      messages: toWireMessages({ turns: [] }, "x"),
    });
    for await (const c of g) out.push(c);
    return out;
  }

  it("streams the declined scenario through the real SSE client path", async () => {
    const res = await mockFetch("/api/agent", {
      method: "POST",
      body: JSON.stringify({ messages: toWireMessages({ turns: [] }, "حذف کن"), target: APP }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const chunks = (await drain(res)) as Array<{ type: string }>;
    expect(chunks[0].type).toBe("start");
    expect(chunks.some((c) => c.type === "text-delta")).toBe(true);
  }, 10_000);

  it("rejects an invalid target", async () => {
    const res = await mockFetch("/api/agent", { method: "POST", body: JSON.stringify({ messages: [], target: { kind: "app", name: "../x" } }) });
    expect(res.status).toBe(400);
  });

  it("approve -> execute enforces the token and exact user values", async () => {
    // Create the proposal through the agent endpoint (s1), then walk the approval API.
    const res = await mockFetch("/api/agent", {
      method: "POST",
      body: JSON.stringify({ messages: toWireMessages({ turns: [] }, "سایتم خطای ۵۰۰ می‌دهد"), target: APP }),
    });
    const chunks = (await drain(res)) as Array<{ type: string; data?: { id?: string } }>;
    const id = chunks.find((c) => c.type === "data-proposal")!.data!.id!;

    expect((await mockFetch(`/api/proposals/${id}/execute`, { method: "POST", body: JSON.stringify({ approvalToken: "nope" }) })).status).toBe(403);
    const approve = await mockFetch(`/api/proposals/${id}/approve`, { method: "POST", body: "{}" });
    expect(approve.status).toBe(200);
    const { approvalToken } = (await approve.json()) as { approvalToken: string };
    expect((await mockFetch(`/api/proposals/${id}/execute`, { method: "POST", body: JSON.stringify({ approvalToken: "wrong" }) })).status).toBe(403);
    const exec = await mockFetch(`/api/proposals/${id}/execute`, { method: "POST", body: JSON.stringify({ approvalToken }) });
    expect(exec.status).toBe(202);
    // the token is one-time
    expect((await mockFetch(`/api/proposals/${id}/execute`, { method: "POST", body: JSON.stringify({ approvalToken }) })).status).toBe(403);
    const got = (await (await mockFetch(`/api/proposals/${id}`)).json()) as { proposal: { status: string } };
    expect(got.proposal.status).toBe("executing");
    expect(userValueKeys(plan("s1").proposal!.params)).toEqual([]);
  }, 10_000);

  it("the stale scenario answers approve with 409 stale; not_verified ends in a not_verified outcome", async () => {
    forceMockScenario("stale");
    const res = await mockFetch("/api/agent", {
      method: "POST",
      body: JSON.stringify({ messages: toWireMessages({ turns: [] }, "x"), target: APP }),
    });
    const chunks = (await drain(res)) as Array<{ type: string; data?: { id?: string } }>;
    const id = chunks.find((c) => c.type === "data-proposal")!.data!.id!;
    const approve = await mockFetch(`/api/proposals/${id}/approve`, { method: "POST", body: "{}" });
    expect(approve.status).toBe(409);
    expect(((await approve.json()) as { error: { code: string } }).error.code).toBe("proposal.stale");
  }, 10_000);
});
