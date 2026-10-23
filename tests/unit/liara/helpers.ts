import { createLiaraClient, type LiaraClient } from "../../../lib/liara";

export const TOKEN = "tok_SYNTHETIC_secret_0123456789";

export interface Call {
  method: string;
  url: URL;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: BodyInit | null | undefined;
}
export interface FakeReply {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}
export type Handler = (call: Call, n: number) => FakeReply | Promise<FakeReply> | Error;

/** Fake `fetch` that records calls. A route handler may return an Error to simulate a network failure. */
export function makeFake(handler: Handler) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: Call = { method: init?.method ?? "GET", url, path: url.pathname, headers, body, rawBody: init?.body };
    calls.push(call);
    const r = await handler(call, calls.length);
    if (r instanceof Error) throw r;
    const text = r.text ?? (r.json === undefined ? "" : JSON.stringify(r.json));
    return new Response(text === "" && (r.status ?? 200) === 204 ? null : text, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function clientFor(handler: Handler, extra: Partial<Parameters<typeof createLiaraClient>[0]> = {}) {
  const fake = makeFake(handler);
  const client: LiaraClient = createLiaraClient({
    token: TOKEN,
    fetchImpl: fake.fetchImpl,
    retryBaseDelayMs: 0,
    ...extra,
  });
  return { client, ...fake };
}

/** Route table: "METHOD /path" -> reply (or function). Unknown routes answer 404. */
export function routes(table: Record<string, FakeReply | ((c: Call) => FakeReply)>, extra: Partial<Parameters<typeof createLiaraClient>[0]> = {}) {
  return clientFor((c) => {
    const hit = table[`${c.method} ${c.path}`];
    if (!hit) return { status: 404, json: { statusCode: 404, message: "not found" } };
    return typeof hit === "function" ? hit(c) : hit;
  }, extra);
}
