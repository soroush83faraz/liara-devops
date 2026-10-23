import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLiaraClient, isLiaraError, LiaraError, type LiaraErrorKind } from "../../../lib/liara";
import { clientFor, TOKEN } from "./helpers";

const any = z.unknown();

describe("request basics", () => {
  it("sends bearer auth and an empty teamID for personal accounts", async () => {
    const { client, calls } = clientFor(() => ({ json: { ok: 1 } }));
    await client.get("/v1/me", any);
    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].url.searchParams.get("teamID")).toBe("");
    expect(calls[0].url.origin).toBe("https://api.liara.ir");
  });

  it("sends the team id and query params", async () => {
    const { client, calls } = clientFor(() => ({ json: {} }), { teamId: "team-1" });
    await client.get("/v1/domains", any, { query: { project: "a b", skip: undefined } });
    expect(calls[0].url.searchParams.get("teamID")).toBe("team-1");
    expect(calls[0].url.searchParams.get("project")).toBe("a b");
    expect(calls[0].url.searchParams.has("skip")).toBe(false);
  });

  it("sends JSON bodies with a content type", async () => {
    const { client, calls } = clientFor(() => ({ json: {} }));
    await client.post("/x", any, { json: { a: 1 } });
    expect(calls[0].body).toEqual({ a: 1 });
    expect(calls[0].headers["content-type"]).toBe("application/json");
  });

  it("treats an empty body as undefined and reports schema mismatches without values", async () => {
    const empty = clientFor(() => ({ status: 200 }));
    await expect(empty.client.post("/x", any)).resolves.toBeUndefined();

    const bad = clientFor(() => ({ json: { projects: "SECRET-VALUE" } }));
    const err = await bad.client.get("/x", z.object({ projects: z.array(z.string()) })).catch((e) => e);
    expect(err).toBeInstanceOf(LiaraError);
    expect(err.code).toBe("schema_mismatch");
    expect(err.message).not.toContain("SECRET-VALUE");
  });

  it("rejects a missing token", () => {
    expect(() => createLiaraClient({ token: "" })).toThrow();
  });
});

describe("error mapping", () => {
  const cases: Array<[number, unknown, LiaraErrorKind, string?]> = [
    [400, { statusCode: 400, message: "bad input" }, "validation"],
    [400, { statusCode: 400, message: "frozen_project" }, "payment", "frozen_project"],
    [401, { message: "Unauthorized" }, "auth"],
    [402, {}, "payment"],
    [403, { statusCode: 403, message: "x", data: { code: "free_plan_platform" } }, "forbidden", "free_plan_platform"],
    [403, { data: { code: "free_plan_count" } }, "forbidden", "free_plan_count"],
    [404, { message: "App not found" }, "not_found"],
    [408, {}, "timeout"],
    [409, { message: "exists" }, "conflict"],
    [413, {}, "validation"],
    [428, { data: { code: "max_deployment_count_in_day" } }, "rate_limited", "max_deployment_count_in_day"],
    [428, { data: { code: "germany_builder_not_allowed" } }, "forbidden", "germany_builder_not_allowed"],
    [428, {}, "validation"],
    [429, {}, "rate_limited"],
    [500, {}, "server"],
    [503, "upstream down", "server"],
  ];
  it.each(cases)("maps %i %j -> %s", async (status, body, kind, code) => {
    // GET is retried for 429/5xx, so use a POST to see the first response unchanged.
    const { client } = clientFor(() => (typeof body === "string" ? { status, text: body } : { status, json: body }));
    const err = (await client.post("/x", any).catch((e) => e)) as LiaraError;
    expect(isLiaraError(err)).toBe(true);
    expect(err.status).toBe(status);
    expect(err.kind).toBe(kind);
    expect(err.code).toBe(code);
  });

  it("maps array messages and keeps the Liara body", async () => {
    const { client } = clientFor(() => ({ status: 400, json: { statusCode: 400, message: ["a is required", "b must be a number"] } }));
    const err = (await client.post("/x", any).catch((e) => e)) as LiaraError;
    expect(err.message).toContain("a is required; b must be a number");
    expect(err.body).toMatchObject({ statusCode: 400 });
  });

  it("maps network failures and client timeouts", async () => {
    const net = clientFor(() => new Error("ECONNRESET"));
    const e1 = (await net.client.post("/x", any).catch((e) => e)) as LiaraError;
    expect(e1.kind).toBe("network");

    const slow = createLiaraClient({
      token: TOKEN,
      timeoutMs: 20,
      fetchImpl: ((_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as typeof fetch,
    });
    const e2 = (await slow.post("/x", any).catch((e) => e)) as LiaraError;
    expect(e2.kind).toBe("timeout");
  });

  it("reports caller aborts as network/aborted without retrying", async () => {
    const ac = new AbortController();
    ac.abort();
    const { client, calls } = clientFor(() => ({ json: {} }));
    const err = (await client.get("/x", any, { signal: ac.signal }).catch((e) => e)) as LiaraError;
    expect(err.code).toBe("aborted");
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});

describe("retries", () => {
  it("retries idempotent GETs on 500 then succeeds", async () => {
    const { client, calls } = clientFor((_c, n) => (n < 3 ? { status: 500, json: {} } : { json: { ok: true } }));
    await expect(client.get("/x", any)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it("retries GET on network errors and on 429 honouring Retry-After", async () => {
    const net = clientFor((_c, n) => (n === 1 ? new Error("ECONNRESET") : { json: { ok: 1 } }));
    await net.client.get("/x", any);
    expect(net.calls).toHaveLength(2);

    const rl = clientFor((_c, n) => (n === 1 ? { status: 429, headers: { "retry-after": "0" }, json: {} } : { json: { ok: 1 } }));
    await rl.client.get("/x", any);
    expect(rl.calls).toHaveLength(2);
  });

  it("gives up after the configured retries and returns the last error", async () => {
    const { client, calls } = clientFor(() => ({ status: 503, json: {} }), { retries: 2 });
    const err = (await client.get("/x", any).catch((e) => e)) as LiaraError;
    expect(err.kind).toBe("server");
    expect(calls).toHaveLength(3);
  });

  it("does not retry GET on 404/401/409", async () => {
    for (const status of [401, 404, 409]) {
      const { client, calls } = clientFor(() => ({ status, json: {} }));
      await client.get("/x", any).catch(() => undefined);
      expect(calls).toHaveLength(1);
    }
  });

  it("NEVER retries mutations (POST/PATCH/DELETE) on 500, 429 or network errors", async () => {
    for (const reply of [{ status: 500, json: {} }, { status: 429, json: {} }, new Error("ECONNRESET")] as const) {
      for (const m of ["post", "patch", "delete"] as const) {
        const { client, calls } = clientFor(() => reply as never);
        await client[m]("/x", any).catch(() => undefined);
        expect(calls).toHaveLength(1);
      }
    }
  });
});

describe("secrets hygiene", () => {
  it("never puts the token or Authorization header into error text/body", async () => {
    const echo = clientFor((c) => ({ status: 500, json: { message: `bad header ${c.headers.authorization}`, echo: TOKEN } }));
    const e1 = (await echo.client.post("/x", any).catch((e) => e)) as LiaraError;
    const net = clientFor(() => new Error(`socket hang up while sending ${TOKEN}`));
    const e2 = (await net.client.post("/x", any).catch((e) => e)) as LiaraError;
    for (const e of [e1, e2]) {
      const dump = `${e.message} ${e.stack ?? ""} ${JSON.stringify(e.body ?? null)} ${JSON.stringify(e)}`;
      expect(dump).not.toContain(TOKEN);
    }
  });

  it("does not put the token in the URL", async () => {
    const { client, calls } = clientFor(() => ({ json: {} }));
    await client.get("/v1/me", any);
    expect(calls[0].url.toString()).not.toContain(TOKEN);
  });
});

describe("concurrency", () => {
  it("never runs more than maxConcurrent requests at once", async () => {
    let active = 0;
    let peak = 0;
    const { client } = clientFor(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return { json: {} };
      },
      { maxConcurrent: 2 },
    );
    await Promise.all(Array.from({ length: 8 }, () => client.get("/x", any)));
    expect(peak).toBe(2);
  });
});
