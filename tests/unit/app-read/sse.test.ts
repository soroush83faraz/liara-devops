// Synthetic streams only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeSseEvent, HEARTBEAT_COMMENT, sseResponse, toStreamError } from "../../../lib/service/app-read/sse";
import { LiaraError } from "../../../lib/liara";

afterEach(() => vi.useRealTimers());

async function readAll(res: Response): Promise<string> {
  return await res.text();
}

describe("encodeSseEvent", () => {
  it("emits a single data line of JSON terminated by a blank line", () => {
    expect(encodeSseEvent({ a: 1 })).toBe('data: {"a":1}\n\n');
    expect(encodeSseEvent({ x: "line1\nline2" })).toBe('data: {"x":"line1\\nline2"}\n\n');
  });
  it("supports event/id/retry and strips newlines from headers", () => {
    expect(encodeSseEvent(1, { event: "e\nx", id: "7", retryMs: 3000 })).toBe("retry: 3000\nid: 7\nevent: e x\ndata: 1\n\n");
  });
});

describe("toStreamError", () => {
  it("maps Liara errors to safe fatal/non-fatal events without raw messages", () => {
    const auth = toStreamError(new LiaraError({ status: 401, kind: "auth", message: "secret-detail" }));
    expect(auth).toMatchObject({ kind: "error", code: "liara_auth", fatal: true });
    expect(JSON.stringify(auth)).not.toContain("secret-detail");
    expect(toStreamError(new LiaraError({ status: 502, kind: "server", message: "x" })).fatal).toBeUndefined();
    expect(toStreamError(new Error("boom")).code).toBe("internal");
  });
});

describe("sseResponse", () => {
  it("sets SSE headers and sends heartbeats until max duration, then the end event", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const res = sseResponse({
      heartbeatMs: 1000,
      maxDurationMs: 3500,
      endEvent: { kind: "end" },
      onClose,
      run: ({ signal }) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const text = readAll(res);
    await vi.advanceTimersByTimeAsync(4000);
    const body = await text;
    expect(body.split(HEARTBEAT_COMMENT).length - 1).toBe(3);
    expect(body).toContain('data: {"kind":"end"}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("aborts run and cleans up when the client disconnects", async () => {
    const ac = new AbortController();
    const onClose = vi.fn();
    let sawAbort = false;
    const res = sseResponse({
      signal: ac.signal,
      onClose,
      run: ({ signal }) => new Promise<void>((resolve) => signal.addEventListener("abort", () => { sawAbort = true; resolve(); })),
    });
    const reader = res.body!.getReader();
    await reader.read(); // hello frame
    ac.abort();
    const next = await reader.read();
    expect(next.done).toBe(true);
    expect(sawAbort).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends a safe error frame when run throws, then closes", async () => {
    const onClose = vi.fn();
    const res = sseResponse({
      onClose,
      run: async () => {
        throw new LiaraError({ status: 404, kind: "not_found", message: "internal-detail" });
      },
    });
    const body = await readAll(res);
    expect(body).toContain('"code":"not_found"');
    expect(body).not.toContain("internal-detail");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
