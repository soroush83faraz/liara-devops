// S6 regression: the probe's SSRF guard missed IPv4-compatible / 6to4 / site-local / documentation / benchmarking
// ranges, and the connection was made by fetch, which resolves the host AGAIN after the guard checked it (DNS
// rebinding). Now every address form is classified, the host is resolved once, and the socket is pinned to the
// validated address. SYNTHETIC: local sockets only, no external network.
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { isAllowedHostname, isPrivateAddress } from "@/lib/canvas/ip-guard";
import { pinnedGet, pinnedLookup, probeHost, type ProbeTransport } from "@/lib/canvas/probe";

const BLOCKED = [
  // IPv4 special-purpose ranges
  "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.255.255.254",
  "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.0.2.255", "192.88.99.1",
  "192.168.0.1", "192.168.255.255", "198.18.0.1", "198.19.255.255", "198.51.100.1", "198.51.100.254", "203.0.113.1",
  "203.0.113.200", "224.0.0.1", "239.255.255.250", "240.0.0.1", "250.1.2.3", "255.255.255.255",
  // IPv6
  "::", "::1", "::7f00:1", "::127.0.0.1", "::a9fe:a9fe", "::0.0.0.1", "::8.8.8.8",
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:0a00:0001", "::ffff:c0a8:0101", "::ffff:0:7f00:1",
  "64:ff9b::7f00:1", "64:ff9b::808:808", "64:ff9b:1::a00:1", "100::1", "2002:7f00:1::1", "2002:a9fe:a9fe::1", "2002:808:808::1",
  "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:2::1", "2001:10::1", "2001:db8::1", "3fff::1", "3fff:fff::1",
  "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "febf::1", "fec0::1", "feff::1", "ff02::1", "ff0e::1",
  // not an address at all
  "not-an-ip", "", "1.2.3", "1.2.3.4.5",
];
const PUBLIC = ["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "192.0.3.1", "198.20.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::200e", "::ffff:8.8.8.8", "::ffff:5db8:d822"];

describe("isPrivateAddress table", () => {
  it(`blocks ${BLOCKED.length} special-purpose / embedded / malformed addresses`, () => {
    expect(BLOCKED.length).toBeGreaterThanOrEqual(60);
    const leaked = BLOCKED.filter((ip) => !isPrivateAddress(ip));
    expect(leaked).toEqual([]);
  });
  it("allows ordinary public unicast (v4, v6 and v4-mapped public)", () => {
    expect(PUBLIC.filter((ip) => isPrivateAddress(ip))).toEqual([]);
  });
});

describe("isAllowedHostname", () => {
  it("refuses inet_aton spellings of addresses and reserved TLDs", () => {
    for (const h of ["0x7f.1", "127.1", "017700000001", "0x7f000001", "1.1", "a.0x7f", "svc.test", "x.invalid", "x.example", "1.0.0.127.in-addr.arpa", "abc.onion", "localhost.", "foo.localhost"]) {
      expect(isAllowedHostname(h), h).toBe(false);
    }
    for (const h of ["shop.liara.run", "www.example.com", "xn--mgbh0fb.xn--mgba3a4f16a", "a1.b2.ir"]) expect(isAllowedHostname(h), h).toBe(true);
  });
});

describe("DNS rebinding: resolve once, connect to the validated address only", () => {
  it("every hop uses the first validated address; a rebinding resolver is never consulted again", async () => {
    let calls = 0;
    const resolve = vi.fn(async () => (++calls === 1 ? ["93.184.216.34"] : ["127.0.0.1"]));
    const seq = [{ status: 301, location: "/a" }, { status: 302, location: "https://rebind.example.com/b" }, { status: 200, location: null }];
    const transport = vi.fn<ProbeTransport>(async () => seq.shift()!);
    const r = await probeHost("rebind.example.com", { resolve, transport });
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls.map(([, init]) => init.address)).toEqual(["93.184.216.34", "93.184.216.34", "93.184.216.34"]);
  });

  it("pinnedLookup answers every query (single or all) with the pinned address", async () => {
    const lookup = pinnedLookup("93.184.216.34");
    const single = await new Promise<[unknown, unknown]>((res) => lookup("attacker-rebinds.example.com", {}, (_e, a, f) => res([a, f])));
    expect(single).toEqual(["93.184.216.34", 4]);
    const all = await new Promise<unknown>((res) => lookup("x.example.com", { all: true }, (_e, a) => res(a)));
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
    const v6 = await new Promise<[unknown, unknown]>((res) => pinnedLookup("2606:4700:4700::1111")("x", {}, (_e, a, f) => res([a, f])));
    expect(v6).toEqual(["2606:4700:4700::1111", 6]);
  });

  it("pinnedGet sets SNI/Host to the name, the pinned lookup, and no shared agent (https)", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fakeRequest = ((opts: Record<string, unknown>) => {
      seen.push(opts);
      throw Object.assign(new Error("stop"), { code: "ECONNREFUSED" });
    }) as never;
    await expect(
      pinnedGet(new URL("https://shop.example.com/x?y=1"), { address: "93.184.216.34", signal: AbortSignal.timeout(1000), maxBytes: 10, headers: {} }, fakeRequest),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(seen[0]).toMatchObject({ host: "shop.example.com", servername: "shop.example.com", path: "/x?y=1", agent: false, family: 4 });
    expect(typeof seen[0].lookup).toBe("function");
  });

  it("a real socket connects to the pinned address although the host name does not resolve at all", async () => {
    const headers: IncomingHttpHeaders[] = [];
    const server = createServer((req, res) => {
      headers.push(req.headers);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(512 * 1024)); // larger than the cap: the client stops reading early
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const url = new URL(`http://rebind-target.invalid:${port}/health`);
      const r = await pinnedGet(url, { address: "127.0.0.1", signal: AbortSignal.timeout(5000), maxBytes: 1024, headers: { "User-Agent": "probe-test" } });
      expect(r).toEqual({ status: 200, location: null });
      expect(headers[0].host).toBe(`rebind-target.invalid:${port}`);
      expect(headers[0]["user-agent"]).toBe("probe-test");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("refuses to pin something that is not an IP address", async () => {
    await expect(pinnedGet(new URL("https://a.example.com/"), { address: "evil.example.com", signal: AbortSignal.timeout(1000), maxBytes: 1, headers: {} })).rejects.toMatchObject({ code: "EINVAL" });
  });
});
