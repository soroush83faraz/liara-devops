// Server-sent events + AI SDK UI-message-stream decoding. Pure (works on any ReadableStream<Uint8Array>).
// Wire format: `data: <json>\n\n` per chunk and a final `data: [DONE]`. Named events (`event: execution`) are also
// accepted: they are mapped to a `data-<name>` chunk so endpoints that do not wrap parts still work.

export interface SseEvent {
  event?: string;
  data: string;
}

export const SSE_DONE = Symbol("sse-done");
const MAX_BUFFER = 2_000_000;

export class StreamStalledError extends Error {
  constructor() {
    super("stream stalled");
    this.name = "StreamStalledError";
  }
}

/** Splits an SSE byte stream into events. Handles CRLF, comments, multi-line data and chunk boundaries anywhere. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  opts: { signal?: AbortSignal; idleTimeoutMs?: number } = {},
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const onAbort = () => void reader.cancel().catch(() => undefined);
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const result = await readWithTimeout(reader, opts.idleTimeoutMs);
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      if (buffer.length > MAX_BUFFER) throw new Error("sse buffer overflow");
      let split = findBoundary(buffer);
      while (split) {
        const raw = buffer.slice(0, split.index);
        buffer = buffer.slice(split.index + split.length);
        const ev = parseEventBlock(raw);
        if (ev) yield ev;
        split = findBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    const tail = parseEventBlock(buffer);
    if (tail) yield tail;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock?.();
  }
}

function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, ms?: number) {
  if (!ms) return reader.read();
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new StreamStalledError());
    }, ms);
    reader.read().then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function findBoundary(buf: string): { index: number; length: number } | null {
  const m = /\r\n\r\n|\n\n|\r\r/.exec(buf);
  return m ? { index: m.index, length: m[0].length } : null;
}

function parseEventBlock(block: string): SseEvent | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r\n|\n|\r/)) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

/** One SSE event -> a chunk object, `SSE_DONE`, or `null` for undecodable/ignorable input. */
export function decodeChunk(ev: SseEvent): unknown | typeof SSE_DONE | null {
  const raw = ev.data.trim();
  if (raw === "[DONE]") return SSE_DONE;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.type === "string") return obj;
  if (ev.event && /^[a-z][a-z-]{0,30}$/.test(ev.event)) {
    return { type: `data-${ev.event}`, data: "data" in obj ? obj.data : obj };
  }
  return null;
}
