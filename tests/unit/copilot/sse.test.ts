import { describe, expect, it } from "vitest";
import { decodeChunk, readSse, SSE_DONE, StreamStalledError } from "@/lib/copilot/sse";
import { classifyFailure, ApiFailure, streamAgent, toWireMessages } from "@/lib/copilot/stream-client";
import { applyChunk, emptyThread, finishTurn, startTurn } from "@/lib/copilot/thread";

function streamOf(parts: string[], delayAfter?: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      if (delayAfter === undefined) c.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const out: Array<{ event?: string; data: string }> = [];
  for await (const e of readSse(body)) out.push(e);
  return out;
}

describe("SSE parsing", () => {
  it("splits events across arbitrary chunk boundaries, including inside multi-byte characters", async () => {
    const text = 'data: {"a":"سلام"}\n\ndata: {"b":2}\n\n';
    const bytes = new TextEncoder().encode(text);
    const enc: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 3) enc.push(bytes.slice(i, i + 3));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const b of enc) c.enqueue(b);
        c.close();
      },
    });
    const events = await collect(body);
    expect(events.map((e) => JSON.parse(e.data))).toEqual([{ a: "سلام" }, { b: 2 }]);
  });

  it("handles CRLF, comments, multi-line data and named events", async () => {
    const events = await collect(streamOf([": ping\r\n\r\nevent: execution\r\ndata: {\"x\":\r\ndata: 1}\r\n\r\n"]));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("execution");
    expect(events[0].data).toBe('{"x":\n1}');
  });

  it("decodes chunks, [DONE], junk and named events", () => {
    expect(decodeChunk({ data: "[DONE]" })).toBe(SSE_DONE);
    expect(decodeChunk({ data: "not json" })).toBeNull();
    expect(decodeChunk({ data: "[1,2]" })).toBeNull();
    expect(decodeChunk({ data: '{"type":"data-step","data":{}}' })).toMatchObject({ type: "data-step" });
    expect(decodeChunk({ event: "execution", data: '{"proposalId":"p","step":"s","status":"done"}' })).toEqual({
      type: "data-execution",
      data: { proposalId: "p", step: "s", status: "done" },
    });
  });

  it("flushes a final event without a trailing blank line", async () => {
    const events = await collect(streamOf(['data: {"z":1}']));
    expect(events).toHaveLength(1);
  });

  it("times out a stalled stream", async () => {
    const never = new ReadableStream<Uint8Array>({ start() {} });
    await expect(
      (async () => {
        for await (const e of readSse(never, { idleTimeoutMs: 20 })) void e;
      })(),
    ).rejects.toBeInstanceOf(StreamStalledError);
  });
});

describe("agent stream client", () => {
  const target = { kind: "app", name: "shop" } as const;

  it("posts messages + target and yields decoded chunks until [DONE]", async () => {
    let seen: { url: string; body: unknown } | undefined;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen = { url, body: JSON.parse(String(init?.body)) };
      return new Response(streamOf(['data: {"type":"start"}\n\n', 'data: {"type":"data-step","id":"a","data":{"id":"a","label":"L","status":"done"}}\n\n', "data: [DONE]\n\n", 'data: {"type":"never"}\n\n']), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const chunks: unknown[] = [];
    for await (const c of streamAgent({ fetchImpl, target, messages: toWireMessages({ turns: [] }, "hi") })) chunks.push(c);
    expect(seen?.url).toBe("/api/agent");
    expect(seen?.body).toMatchObject({ target, messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] });
    expect(chunks).toHaveLength(2);
  });

  it("turns HTTP errors into ApiFailure and classifies them", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { code: "rate_limited", retryAfterSec: 12 } }), { status: 429 });
    const gen = streamAgent({ fetchImpl, target, messages: [] });
    const err = await gen.next().catch((e) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(classifyFailure(err)).toMatchObject({ kind: "rateLimited", retryAfterSec: 12 });
    expect(classifyFailure(new ApiFailure(401, "x")).kind).toBe("unauthorized");
    expect(classifyFailure(new ApiFailure(503, "x")).kind).toBe("server");
    expect(classifyFailure(new ApiFailure(409, "x")).kind).toBe("conflict");
    expect(classifyFailure(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(classifyFailure(new StreamStalledError()).kind).toBe("stream");
  });

  it("an aborted fetch rejects (the store maps it to an aborted turn)", async () => {
    const controller = new AbortController();
    const fetchImpl = async (_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError"))));
    const gen = streamAgent({ fetchImpl, target, messages: [], signal: controller.signal });
    const p = gen.next();
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("the wire history carries only text (never cards or evidence) and is capped", () => {
    const started = startTurn(emptyThread(), "first");
    const turnId = started.turnId;
    let thread = started.thread;
    thread = applyChunk(thread, turnId, { type: "data-step", id: "a", data: { id: "a", label: "L", status: "done" } });
    thread = applyChunk(thread, turnId, { type: "text-delta", id: "t", delta: "answer" });
    thread = finishTurn(thread, turnId);
    const wire = toWireMessages(thread, "second");
    expect(wire.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(wire)).not.toContain("data-step");
    const many = { turns: Array.from({ length: 40 }, (_, i) => ({ ...thread.turns[0], id: `t${i}` })) };
    expect(toWireMessages(many).length).toBeLessThanOrEqual(20);
  });
});
