import { describe, expect, it } from "vitest";
import { failingFinding, proposalFixtures, sampleVerification } from "@/lib/contracts/fixtures";
import { dedupeExecutions, groupTurn, hasIncompleteEvidence } from "@/lib/copilot/blocks";
import {
  abortTurn,
  applyChunk,
  applyProposalEvent,
  emptyThread,
  failTurn,
  finishTurn,
  isDegradeCode,
  restartTurn,
  startTurn,
  type Thread,
} from "@/lib/copilot/thread";

const step = (id: string, status: "pending" | "running" | "done" | "failed" | "skipped", label = "L") => ({
  type: "data-step",
  id,
  data: { id, label, status },
});
const exec = (proposalId: string, s: string, status: "pending" | "running" | "done" | "failed" | "skipped", id?: string) => ({
  type: "data-execution",
  ...(id ? { id } : {}),
  data: { proposalId, step: s, status },
});

function begin(text = "q"): { thread: Thread; id: string } {
  const r = startTurn(emptyThread(), text);
  return { thread: r.thread, id: r.turnId };
}
const feed = (thread: Thread, id: string, chunks: unknown[]) => chunks.reduce<Thread>((t, c) => applyChunk(t, id, c), thread);
const cards = (t: Thread, i = 0) => t.turns[i].cards;

describe("thread reducer: in-place updates", () => {
  it("updates a step in place by part id and keeps arrival order", () => {
    const { thread, id } = begin();
    const t = feed(thread, id, [step("a", "running"), step("b", "pending"), step("a", "done")]);
    expect(cards(t).map((c) => c.key)).toEqual(["step:a", "step:b"]);
    expect(cards(t)[0]).toMatchObject({ kind: "step", data: { status: "done" } });
  });

  it("uses the explicit part id when it differs from the data id", () => {
    const { thread, id } = begin();
    const t = feed(thread, id, [
      { type: "data-step", id: "p1", data: { id: "x", label: "L", status: "running" } },
      { type: "data-step", id: "p1", data: { id: "x", label: "L", status: "done" } },
    ]);
    expect(cards(t)).toHaveLength(1);
  });

  it("is idempotent when a stream is replayed (resume / retry)", () => {
    const { thread, id } = begin();
    const chunks = [
      { type: "start" },
      step("a", "running"),
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "ab" },
      { type: "text-delta", id: "t", delta: "cd" },
      { type: "data-finding", id: "finding", data: failingFinding },
      step("a", "done"),
    ];
    const once = feed(thread, id, chunks);
    const twice = feed(once, id, chunks);
    expect(cards(twice).map((c) => c.key)).toEqual(cards(once).map((c) => c.key));
    expect(cards(twice).find((c) => c.kind === "text")).toMatchObject({ text: "abcd" });
  });

  it("appends text deltas and accepts a delta without text-start", () => {
    const { thread, id } = begin();
    const t = feed(thread, id, [{ type: "text-delta", id: "t", delta: "ab" }, { type: "text-delta", id: "t", delta: "c" }]);
    expect(cards(t)[0]).toMatchObject({ kind: "text", text: "abc" });
  });
});

describe("thread reducer: out-of-order and invalid input", () => {
  it("never regresses a finished step to running", () => {
    const { thread, id } = begin();
    const t = feed(thread, id, [step("a", "done"), step("a", "running")]);
    expect(cards(t)[0]).toMatchObject({ data: { status: "done" } });
  });

  it("never regresses a proposal status", () => {
    const { thread, id } = begin();
    const t = feed(thread, id, [
      { type: "data-proposal", id: "p", data: proposalFixtures.verified },
      { type: "data-proposal", id: "p", data: { ...proposalFixtures.proposed, id: proposalFixtures.verified.id } },
    ]);
    expect(cards(t)[0]).toMatchObject({ kind: "proposal", data: { status: "verified" } });
  });

  it("execution before its proposal still groups under the proposal", () => {
    const { thread, id } = begin();
    const pid = proposalFixtures.executing.id;
    const t = feed(thread, id, [
      exec(pid, "send", "done", "e1"),
      { type: "data-proposal", id: pid, data: proposalFixtures.executing },
      { type: "data-verification", id: "v", data: { proposalId: pid, result: sampleVerification } },
    ]);
    const blocks = groupTurn(t.turns[0], t);
    const proposalBlock = blocks.find((b) => b.kind === "proposal");
    expect(proposalBlock).toMatchObject({ kind: "proposal" });
    expect(proposalBlock && proposalBlock.kind === "proposal" ? proposalBlock.executions.map((e) => e.step) : []).toEqual(["send"]);
    expect(proposalBlock && proposalBlock.kind === "proposal" ? proposalBlock.verification?.result.outcome : null).toBe("verified");
    expect(blocks.some((b) => b.kind === "orphan")).toBe(false);
  });

  it("execution without a proposal renders as an orphan block instead of being dropped", () => {
    const { thread, id } = begin();
    const t = feed(thread, id, [exec("p_unknown", "send", "running")]);
    expect(groupTurn(t.turns[0], t).map((b) => b.kind)).toEqual(["orphan"]);
  });

  it("drops invalid data parts, counts them, and ignores unknown chunks", () => {
    const { thread, id } = begin();
    const t = feed(thread, id, [
      { type: "data-step", id: "a", data: { id: "a", label: "", status: "running" } },
      { type: "data-finding", data: { facts: "nope" } },
      { type: "data-unknown", data: {} },
      { type: "tool-input-available", toolCallId: "x" },
      null,
      "string",
    ]);
    expect(cards(t)).toHaveLength(0);
    expect(t.turns[0].invalidParts).toBe(2);
  });

  it("applies a proposal event to the turn that owns the proposal", () => {
    const first = begin("one");
    let t = feed(first.thread, first.id, [{ type: "data-proposal", id: "p", data: proposalFixtures.proposed }]);
    t = finishTurn(t, first.id);
    const second = startTurn(t, "two");
    const after = applyProposalEvent(second.thread, proposalFixtures.proposed.id, exec(proposalFixtures.proposed.id, "send", "running", "e"));
    expect(after.turns[0].cards.some((c) => c.kind === "execution")).toBe(true);
    expect(after.turns[1].cards).toHaveLength(0);
  });
});

describe("thread reducer: errors, abort, degrade", () => {
  it("an error part mid-stream keeps earlier cards and ends the turn as error", () => {
    const { thread, id } = begin();
    let t = feed(thread, id, [step("a", "running"), { type: "data-error", data: { code: "agent.failed", messageFa: "x" } }]);
    t = finishTurn(t, id);
    expect(t.turns[0].status).toBe("error");
    expect(t.status).toBe("error");
    expect(cards(t).map((c) => c.kind)).toEqual(["step", "error"]);
  });

  it("a stream-level error chunk becomes an error card", () => {
    const { thread, id } = begin();
    const t = feed(thread, id, [{ type: "error", errorText: "boom" }]);
    expect(cards(t)[0]).toMatchObject({ kind: "error", data: { code: "stream.error" }, detail: "boom" });
  });

  it("a transport failure marks running steps failed and keeps the turn retryable", () => {
    const { thread, id } = begin();
    let t = feed(thread, id, [step("a", "running")]);
    t = failTurn(t, id, { code: "network" });
    expect(t.status).toBe("error");
    expect(cards(t)[0]).toMatchObject({ data: { status: "failed" } });
    expect(hasIncompleteEvidence(t.turns[0])).toBe(true);
    const again = restartTurn(t, id);
    expect(again.status).toBe("streaming");
    expect(again.turns[0].status).toBe("streaming");
  });

  it("abort marks unfinished steps skipped and goes idle", () => {
    const { thread, id } = begin();
    let t = feed(thread, id, [step("a", "running"), step("b", "done")]);
    t = abortTurn(t, id);
    expect(t.status).toBe("idle");
    expect(t.turns[0].status).toBe("aborted");
    expect(cards(t).map((c) => (c.kind === "step" ? c.data.status : ""))).toEqual(["skipped", "done"]);
    // a late finish cannot resurrect an aborted turn
    expect(finishTurn(t, id).turns[0].status).toBe("aborted");
  });

  it("an LLM-down error degrades the turn instead of failing it", () => {
    const { thread, id } = begin();
    let t = feed(thread, id, [{ type: "data-error", data: { code: "agent.llm_unavailable", messageFa: "x" } }, { type: "data-finding", data: failingFinding }]);
    t = finishTurn(t, id);
    expect(t.turns[0].degraded).toBe(true);
    expect(t.turns[0].status).toBe("done");
    expect(cards(t).some((c) => c.kind === "error")).toBe(false);
    expect(isDegradeCode("llm_unavailable")).toBe(true);
    expect(isDegradeCode("liara.rate_limited")).toBe(false);
    expect(isDegradeCode("agent.failed")).toBe(false);
  });

  it("collapses repeated execution steps and keeps first-seen order", () => {
    const list = [
      { proposalId: "p", step: "a", status: "running" as const },
      { proposalId: "p", step: "b", status: "pending" as const },
      { proposalId: "p", step: "a", status: "done" as const },
    ];
    expect(dedupeExecutions(list).map((e) => `${e.step}:${e.status}`)).toEqual(["a:done", "b:pending"]);
  });
});
