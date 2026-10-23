import { beforeEach, describe, expect, it } from "vitest";
import { useCopilotStore } from "@/lib/copilot/store";
import { failingFinding } from "@/lib/contracts/fixtures";

const target = { kind: "app", name: "shop" } as const;
const key = "app:shop";

const sse = (chunks: unknown[], opts: { hang?: boolean } = {}) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
        if (!opts.hang) {
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        }
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const step = (status: string) => ({ type: "data-step", id: "a", data: { id: "a", label: "L", status } });
const thread = () => useCopilotStore.getState().threads[key];

describe("copilot store", () => {
  beforeEach(() => useCopilotStore.getState().reset(key));

  it("streams a run into a done turn", async () => {
    await useCopilotStore.getState().send(target, "سلام", {
      fetchImpl: async () => sse([{ type: "start" }, step("running"), step("done"), { type: "data-finding", id: "f", data: failingFinding }]),
    });
    const t = thread();
    expect(t.status).toBe("idle");
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0]).toMatchObject({ userText: "سلام", status: "done" });
    expect(t.turns[0].cards.map((c) => c.kind)).toEqual(["step", "finding"]);
  });

  it("ignores empty input and a second send while streaming", async () => {
    await useCopilotStore.getState().send(target, "   ", { fetchImpl: async () => sse([]) });
    expect(thread()).toBeUndefined();
    let calls = 0;
    const slow = async () => {
      calls++;
      return sse([step("running")], { hang: true });
    };
    const first = useCopilotStore.getState().send(target, "one", { fetchImpl: slow });
    await new Promise((r) => setTimeout(r, 20));
    await useCopilotStore.getState().send(target, "two", { fetchImpl: slow });
    expect(calls).toBe(1);
    useCopilotStore.getState().stop(key);
    await first;
    expect(thread().turns).toHaveLength(1);
  });

  it("stop aborts the run: unfinished steps become skipped and the composer is free again", async () => {
    const p = useCopilotStore.getState().send(target, "q", { fetchImpl: async () => sse([step("running")], { hang: true }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(thread().status).toBe("streaming");
    useCopilotStore.getState().stop(key);
    await p;
    const t = thread();
    expect(t.status).toBe("idle");
    expect(t.turns[0].status).toBe("aborted");
    expect(t.turns[0].cards[0]).toMatchObject({ data: { status: "skipped" } });
  });

  it("an HTTP error ends the turn as an error and retry re-runs the same turn", async () => {
    await useCopilotStore.getState().send(target, "q", {
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: "x" } }), { status: 503 }),
    });
    expect(thread().status).toBe("error");
    expect(thread().error).toMatchObject({ code: "server", status: 503 });
    let sent: unknown;
    await useCopilotStore.getState().retry(target, {
      fetchImpl: async (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return sse([step("done")]);
      },
    });
    const t = thread();
    expect(t.turns).toHaveLength(1); // same turn, not a new one
    expect(t.turns[0].status).toBe("done");
    expect(t.status).toBe("idle");
    expect(JSON.stringify(sent)).toContain("q");
  });

  it("a connection drop mid-stream keeps the cards received so far", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        if (pulls === 1) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(step("running"))}\n\n`));
        else c.error(new TypeError("network lost"));
      },
    });
    await useCopilotStore.getState().send(target, "q", { fetchImpl: async () => new Response(body, { status: 200 }) });
    const t = thread();
    expect(t.status).toBe("error");
    expect(t.error?.code).toBe("network");
    expect(t.turns[0].cards[0]).toMatchObject({ kind: "step", data: { status: "failed" } });
  });

  it("queues a question for a service and hands it over exactly once", () => {
    const s = useCopilotStore.getState();
    s.queueQuestion(key, "  why slow?  ");
    expect(useCopilotStore.getState().takeQuestion(key)).toBe("why slow?");
    expect(useCopilotStore.getState().takeQuestion(key)).toBeUndefined();
  });
});
