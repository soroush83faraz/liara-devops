// SYNTHETIC: a fake fetch and resolver; nothing here touches the network or Liara.
import { describe, expect, it, vi } from "vitest";
import { isAllowedHostname, isPrivateAddress } from "@/lib/canvas/ip-guard";
import { mapFetchError, pickProbeHost, probeApp, probeHost, type ProbeResponse, type ProbeTransport } from "@/lib/canvas/probe";
import { parseProbeBody } from "@/lib/canvas/probe-request";
import { createRateLimiter } from "@/lib/canvas/rate-limit";
import { createTtlCache } from "@/lib/canvas/ttl-cache";
import { createLiaraClient } from "@/lib/liara";

const PUBLIC = async () => ["93.184.216.34"];
const res = (status: number, location: string | null = null): ProbeResponse => ({ status, location });

describe("ip guard", () => {
  it("flags private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "not-an-ip"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("accepts plain public host names only", () => {
    expect(isAllowedHostname("shop.liara.run")).toBe(true);
    expect(isAllowedHostname("www.example.ir")).toBe(true);
    for (const h of ["localhost", "127.0.0.1", "2130706433", "[::1]", "a.local", "svc.internal", "host:8080", "nodot", "-bad.example.com", "a..b.com", ""])
      expect(isAllowedHostname(h), h).toBe(false);
  });
});

describe("pickProbeHost (the server decides the target)", () => {
  it("prefers an active, non-redirecting custom domain, else the default sub-domain", () => {
    const domains = [
      { name: "pending.example.com", certificatesStatus: "PENDING" },
      { name: "redir.example.com", certificatesStatus: "ACTIVE", redirectTo: "www.example.com" },
      { name: "www.example.com", certificatesStatus: "ACTIVE" },
    ];
    expect(pickProbeHost("shop", domains, true)).toBe("www.example.com");
    expect(pickProbeHost("shop", domains.slice(0, 2), true)).toBe("shop.liara.run");
    expect(pickProbeHost("shop", [], false)).toBeUndefined();
    expect(pickProbeHost("bad name!", [], true)).toBeUndefined();
  });
  it("ignores custom domains that are not plain public names", () => {
    expect(pickProbeHost("shop", [{ name: "127.0.0.1", certificatesStatus: "ACTIVE" }], true)).toBe("shop.liara.run");
  });
});

describe("parseProbeBody", () => {
  it("accepts only an app service id and ignores any client-supplied url", () => {
    expect(parseProbeBody({ service: "shop", url: "http://169.254.169.254/" })).toEqual({ name: "shop" });
    expect(parseProbeBody({ url: "http://evil.test" })).toBeNull();
    expect(parseProbeBody({ service: "db:shop-db" })).toBeNull();
    expect(parseProbeBody({ service: "../etc/passwd" })).toBeNull();
    expect(parseProbeBody({ service: 5 })).toBeNull();
    expect(parseProbeBody(null)).toBeNull();
  });
});

describe("probeHost", () => {
  it("returns status and latency for a healthy site, connecting to the validated address", async () => {
    let t = 1000;
    const transport = vi.fn<ProbeTransport>(async () => res(200));
    const r = await probeHost("shop.liara.run", { transport, resolve: PUBLIC, now: () => (t += 25) });
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(r.latencyMs).toBeGreaterThan(0);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url.href).toBe("https://shop.liara.run/");
    expect(init.address).toBe("93.184.216.34");
    expect(init.maxBytes).toBe(64 * 1024);
  });
  it("reports 5xx as not ok", async () => {
    const r = await probeHost("shop.liara.run", { transport: async () => res(503), resolve: PUBLIC });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
  it("refuses hosts that resolve to private addresses without connecting", async () => {
    const transport = vi.fn<ProbeTransport>();
    const r = await probeHost("evil.example.com", { transport, resolve: async () => ["10.0.0.5"] });
    expect(r).toMatchObject({ ok: false, error: "blocked_address" });
    expect(transport).not.toHaveBeenCalled();
    const mixed = await probeHost("evil.example.com", { transport, resolve: async () => ["93.184.216.34", "127.0.0.1"] });
    expect(mixed.error).toBe("blocked_address");
  });
  it("refuses IP literals and local names", async () => {
    const transport = vi.fn<ProbeTransport>();
    for (const h of ["127.0.0.1", "localhost", "169.254.169.254"]) {
      expect((await probeHost(h, { transport, resolve: PUBLIC })).error).toBe("blocked_address");
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not follow redirects to another host or to http; the 3xx itself counts as an answer", async () => {
    for (const location of ["https://other.example.org/", "http://shop.liara.run/", "https://user:pw@shop.liara.run/"]) {
      const transport = vi.fn<ProbeTransport>(async () => res(302, location));
      const r = await probeHost("shop.liara.run", { transport, resolve: PUBLIC });
      expect(r).toMatchObject({ ok: true, status: 302 });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it("follows same-host https redirects up to a limit", async () => {
    const seq = [res(301, "/a"), res(200)];
    const transport = vi.fn<ProbeTransport>(async () => seq.shift()!);
    expect(await probeHost("shop.liara.run", { transport, resolve: PUBLIC })).toMatchObject({ ok: true, status: 200 });
    expect(transport).toHaveBeenCalledTimes(2);

    const loop = vi.fn<ProbeTransport>(async () => res(301, "/again"));
    const r = await probeHost("shop.liara.run", { transport: loop, resolve: PUBLIC });
    expect(r).toMatchObject({ ok: false, error: "too_many_redirects" });
  });
  it("maps network failures to stable codes", async () => {
    const boom = (code: string): ProbeTransport => async () => { throw Object.assign(new Error("connect failed"), { code }); };
    expect((await probeHost("a.example.com", { transport: boom("ENOTFOUND"), resolve: PUBLIC })).error).toBe("dns");
    expect((await probeHost("a.example.com", { transport: boom("ECONNREFUSED"), resolve: PUBLIC })).error).toBe("refused");
    expect((await probeHost("a.example.com", { transport: boom("CERT_HAS_EXPIRED"), resolve: PUBLIC })).error).toBe("tls");
    expect((await probeHost("a.example.com", { transport: boom("ERR_TLS_CERT_ALTNAME_INVALID"), resolve: PUBLIC })).error).toBe("tls");
    expect(mapFetchError(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("timeout");
    expect(mapFetchError(Object.assign(new Error("t"), { name: "AbortError" }))).toBe("timeout");
    expect((await probeHost("a.example.com", { transport: boom("EWHATEVER"), resolve: PUBLIC })).error).toBe("network");
    expect((await probeHost("a.example.com", { transport: boom("EWHATEVER"), resolve: async () => { throw Object.assign(new Error("x"), { code: "ENOTFOUND" }); } })).error).toBe("dns");
  });
});

describe("probeApp resolves the target from Liara, never from the caller", () => {
  function liaraStub(routes: Record<string, unknown>) {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      const body = routes[path];
      return body === undefined ? new Response("{}", { status: 404 }) : Response.json(body);
    });
    return { client: createLiaraClient({ token: "synthetic-token", fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 }), fetchImpl };
  }
  it("probes the verified custom domain returned by Liara", async () => {
    const { client } = liaraStub({
      "/v1/projects/shop": { project: { project_id: "shop", defaultSubdomain: true, envs: [] } },
      "/v1/domains": { domains: [{ name: "www.example.com", certificatesStatus: "ACTIVE" }] },
    });
    const probe = vi.fn<ProbeTransport>(async () => res(200));
    const r = await probeApp(client, "shop", { transport: probe, resolve: PUBLIC });
    expect(r.ok).toBe(true);
    expect(probe.mock.calls[0][0].hostname).toBe("www.example.com");
  });
  it("answers no_url when the default sub-domain is disabled and no domain is active", async () => {
    const { client } = liaraStub({ "/v1/projects/shop": { project: { project_id: "shop", defaultSubdomain: false, envs: [] } }, "/v1/domains": { domains: [] } });
    const probe = vi.fn<ProbeTransport>();
    const r = await probeApp(client, "shop", { transport: probe, resolve: PUBLIC });
    expect(r).toMatchObject({ ok: false, error: "no_url" });
    expect(probe).not.toHaveBeenCalled();
  });
  it("caches the resolved host between probes", async () => {
    const { client, fetchImpl } = liaraStub({ "/v1/projects/shop": { project: { project_id: "shop", envs: [] } }, "/v1/domains": { domains: [] } });
    const targetCache = createTtlCache<string | null>(60_000);
    const deps = { transport: (async () => res(200)) as ProbeTransport, resolve: PUBLIC, targetCache, cacheKey: "acct:shop" };
    await probeApp(client, "shop", deps);
    const callsAfterFirst = fetchImpl.mock.calls.length;
    await probeApp(client, "shop", deps);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("rate limiter and ttl cache", () => {
  it("limits per key within the window and recovers", () => {
    let now = 0;
    const rl = createRateLimiter(3, 60_000, () => now);
    expect([1, 2, 3, 4].map(() => rl.check("a").allowed)).toEqual([true, true, true, false]);
    expect(rl.check("b").allowed).toBe(true);
    now = 61_000;
    expect(rl.check("a").allowed).toBe(true);
  });
  it("caches within ttl, dedupes in-flight loads and does not cache failures", async () => {
    let now = 0;
    const cache = createTtlCache<number>(10_000, 10, () => now);
    const load = vi.fn(async () => 7);
    await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 11_000;
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
    await expect(cache.get("bad", async () => { throw new Error("x"); })).rejects.toThrow();
    expect(await cache.get("bad", async () => 1)).toBe(1);
  });
});
