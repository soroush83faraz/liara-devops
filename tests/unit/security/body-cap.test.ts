// S1 regression: request bodies are read with a hard byte cap. Before the fix /api/session called request.json()
// on an unbounded body (one 300 MB chunked POST: RSS 137 MB -> 1.08 GB) and /api/probe, the db settings routes,
// the app-config routes and the deploy route's JSON branch buffered the whole body before checking its size.
// Each test streams a 64 MiB body WITHOUT a Content-Length (chunked) and asserts a 413/refusal after reading only
// a bounded prefix; a declared oversize Content-Length is refused before a single byte is read.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonCapped } from "@/lib/server/body";
import { listFiles, read, stripComments } from "../quality/scan";

const calls = vi.hoisted(() => ({ probeApp: vi.fn() }));

vi.mock("@/lib/server/liara", async (orig) => {
  const real = await orig<typeof import("@/lib/server/liara")>();
  return {
    ...real,
    api: (handler: (ctx: unknown, ...rest: unknown[]) => Promise<Response>) => (request: Request, ...rest: unknown[]) =>
      handler({ session: { token: "t", accountId: `acc-${Math.random().toString(36).slice(2)}` }, liara: {}, request }, ...rest).catch((e) => real.toErrorResponse(e)),
  };
});
vi.mock("@/lib/canvas/probe", async (orig) => ({ ...(await orig<typeof import("@/lib/canvas/probe")>()), probeApp: calls.probeApp }));

const MiB = 1024 * 1024;

/** A lazily generated body of `total` bytes (JSON-ish whitespace) that counts how much was actually pulled. */
function streamingBody(total = 64 * MiB) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= total) return controller.close();
        const chunk = new Uint8Array(64 * 1024).fill(0x20);
        pulled += chunk.length;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => pulled };
}

function post(url: string, body: ReadableStream<Uint8Array> | string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", body, headers: { "content-type": "application/json", ...headers }, duplex: "half" } as RequestInit & { duplex: "half" });
}

beforeEach(() => {
  calls.probeApp.mockReset().mockResolvedValue({ ok: true, status: 200, latencyMs: 1, checkedAt: "2026-01-01T00:00:00Z" });
  vi.unstubAllGlobals();
});

describe("readJsonCapped", () => {
  it("stops reading a chunked body at the cap and cancels the source", async () => {
    const big = streamingBody();
    const r = await readJsonCapped(post("http://x/", big.stream), 8 * 1024);
    expect(r).toEqual({ ok: false, reason: "too_large" });
    expect(big.pulled()).toBeLessThan(1 * MiB);
  });

  it("refuses a declared oversize Content-Length before reading anything", async () => {
    const big = streamingBody();
    const r = await readJsonCapped(post("http://x/", big.stream, { "content-length": String(300 * MiB) }), 8 * 1024);
    expect(r).toEqual({ ok: false, reason: "too_large" });
    expect(big.pulled()).toBeLessThanOrEqual(64 * 1024);
  });

  it("parses a small body and reports malformed or empty input", async () => {
    expect(await readJsonCapped(post("http://x/", '{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 }, empty: false });
    expect(await readJsonCapped(post("http://x/", "{nope"), 100)).toEqual({ ok: false, reason: "bad_json" });
    expect(await readJsonCapped(post("http://x/", ""), 100)).toEqual({ ok: true, value: undefined, empty: true });
    expect(await readJsonCapped(post("http://x/", "{}", { "content-length": "abc" }), 100)).toEqual({ ok: false, reason: "bad_length" });
    expect(await readJsonCapped(post("http://x/", new TextDecoder().decode(new Uint8Array([0x22, 0xff, 0x22]))), 100)).toMatchObject({ ok: true });
  });
});

describe("routes refuse oversize bodies before buffering them", () => {
  it("POST /api/session: 64 MiB chunked body -> 413 after a bounded read", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/session/route");
    const big = streamingBody();
    const res = await POST(post("http://localhost/api/session", big.stream, { "x-forwarded-for": "203.0.113.10" }));
    expect(res.status).toBe(413);
    expect(big.pulled()).toBeLessThan(1 * MiB);
    expect(fetchSpy).not.toHaveBeenCalled();
    // declared oversize: refused without reading
    const declared = streamingBody();
    const res2 = await POST(post("http://localhost/api/session", declared.stream, { "x-forwarded-for": "203.0.113.11", "content-length": String(300 * MiB) }));
    expect(res2.status).toBe(413);
    expect(declared.pulled()).toBeLessThanOrEqual(64 * 1024);
    // a normal login body still reaches Liara (401 from the stubbed upstream)
    const ok = await POST(post("http://localhost/api/session", JSON.stringify({ token: "abcdefghijkl" }), { "x-forwarded-for": "203.0.113.12" }));
    expect(ok.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("POST /api/probe: oversize body -> 413 after a bounded read", async () => {
    const { POST } = await import("@/app/api/probe/route");
    const big = streamingBody();
    const res = await POST(post("http://localhost/api/probe", big.stream));
    expect(res.status).toBe(413);
    expect(big.pulled()).toBeLessThan(1 * MiB);
    expect(calls.probeApp).not.toHaveBeenCalled();
    const ok = await POST(post("http://localhost/api/probe", JSON.stringify({ service: "shop" })));
    expect(ok.status).toBe(200);
  });

  it("db settings parseBody: oversize body -> refused after a bounded read", async () => {
    const { parseBody, PowerBodySchema } = await import("@/lib/service/db/bodies");
    const big = streamingBody();
    expect(await parseBody(post("http://localhost/x", big.stream), PowerBodySchema)).toBeUndefined();
    expect(big.pulled()).toBeLessThan(1 * MiB);
  });

  it("app-config routes: oversize body -> 413 after a bounded read", async () => {
    const { handleRevealEnv } = await import("@/lib/service/app-config/handlers");
    const big = streamingBody();
    const ctx = { session: { token: "t", accountId: "acc-cfg" }, liara: {}, request: post("http://localhost/x", big.stream) };
    const res = await handleRevealEnv(ctx as never, { name: "shop" });
    expect(res.status).toBe(413);
    expect(big.pulled()).toBeLessThan(1 * MiB);
  });

  it("deploy route JSON branch: a lying Content-Length cannot make it buffer more than the cap", async () => {
    const { POST } = await import("@/app/api/apps/[name]/deploy/route");
    const big = streamingBody();
    const res = await POST(post("http://localhost/api/apps/shop/deploy", big.stream, { "content-length": "100", "x-typed-name": "shop" }), { params: Promise.resolve({ name: "shop" }) });
    expect(res.status).toBe(413);
    expect(big.pulled()).toBeLessThan(1 * MiB);
  });
});

describe("no route or handler reads a request body without a cap", () => {
  it("request.json/text/formData/arrayBuffer/blob/bytes appear only inside the capped readers", () => {
    const ALLOWED = new Set(["lib/server/body.ts"]);
    const files = listFiles(["app/api", "lib/server", "lib/service", "lib/actions/http", "lib/agent", "lib/setup", "lib/create", "lib/canvas"], [".ts", ".tsx"]);
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    const re = /\b(?:request|req|ctx\.request|context\.request)\s*\.\s*(?:json|text|formData|arrayBuffer|blob|bytes)\s*\(/g;
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      const code = stripComments(read(f));
      for (const m of code.matchAll(re)) offenders.push(`${f}:${code.slice(0, m.index).split("\n").length}  ${m[0]}`);
    }
    expect(offenders, "Read bodies with readJsonCapped/readBodyBytesCapped (lib/server/body.ts) or the capped multipart readers:").toEqual([]);
  });
});
