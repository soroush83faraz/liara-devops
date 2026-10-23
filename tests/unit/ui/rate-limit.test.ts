import { describe, expect, it } from "vitest";
import { UNTRUSTED_CLIENT, clientIp, createRateLimiter, trustedProxyHops } from "../../../app/api/session/rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit then blocks with a retry-after", () => {
    const rl = createRateLimiter(10, 60_000);
    for (let i = 0; i < 10; i++) expect(rl.hit("1.1.1.1", 1000).allowed).toBe(true);
    const blocked = rl.hit("1.1.1.1", 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBe(60);
    expect(rl.hit("1.1.1.1", 31_000).retryAfter).toBe(30);
  });

  it("tracks keys independently", () => {
    const rl = createRateLimiter(1, 1000);
    expect(rl.hit("a", 0).allowed).toBe(true);
    expect(rl.hit("a", 1).allowed).toBe(false);
    expect(rl.hit("b", 1).allowed).toBe(true);
  });

  it("opens a new window after the old one expires", () => {
    const rl = createRateLimiter(2, 1000);
    rl.hit("a", 0);
    rl.hit("a", 1);
    expect(rl.hit("a", 2).allowed).toBe(false);
    expect(rl.hit("a", 1000).allowed).toBe(true);
  });

  it("reports remaining attempts", () => {
    const rl = createRateLimiter(3, 1000);
    expect(rl.hit("a", 0).remaining).toBe(2);
    expect(rl.hit("a", 0).remaining).toBe(1);
    expect(rl.hit("a", 0).remaining).toBe(0);
  });

  it("bounds memory when keys rotate", () => {
    const rl = createRateLimiter(1, 60_000, 100);
    for (let i = 0; i < 1000; i++) rl.hit(`k${i}`, i);
    // the oldest keys were evicted, so they get a fresh window
    expect(rl.hit("k0", 1000).allowed).toBe(true);
  });

  it("takes the proxy-appended hop from the RIGHT of X-Forwarded-For (default 1 trusted hop)", () => {
    // "9.9.9.9" was supplied by the client; "10.0.0.1" was appended by the (single) trusted proxy.
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }), 1)).toBe("10.0.0.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 172.16.0.2" }), 2)).toBe("10.0.0.1");
    // fewer entries than hops: the furthest hop available
    expect(clientIp(new Headers({ "x-forwarded-for": "10.0.0.1" }), 3)).toBe("10.0.0.1");
    expect(clientIp(new Headers({ "x-real-ip": "8.8.8.8" }), 1)).toBe("8.8.8.8");
    expect(clientIp(new Headers(), 1)).toBe("unknown");
    expect(clientIp(new Headers({ "x-forwarded-for": "[2001:db8::1]:443" }), 1)).toBe("2001:db8::1");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4:5678" }), 1)).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-forwarded-for": "x".repeat(500) }), 1)).toBe(UNTRUSTED_CLIENT);
  });

  it("rotating spoofed leftmost X-Forwarded-For entries all land in ONE bucket", () => {
    const rl = createRateLimiter(10, 60_000);
    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      const spoofed = `${i}.${i}.${i}.${i}, 198.51.100.${i % 7}`;
      if (rl.hit(clientIp(new Headers({ "x-forwarded-for": `${spoofed}, 203.0.113.9` }), 1), 1000).allowed) allowed++;
    }
    expect(allowed).toBe(10);
  });

  it("TRUSTED_PROXY_HOPS=0 ignores every forwarding header (one shared bucket)", () => {
    for (const h of [{ "x-forwarded-for": "1.1.1.1" }, { "x-forwarded-for": "2.2.2.2, 3.3.3.3" }, { "x-real-ip": "4.4.4.4" }, {}] as Array<Record<string, string>>) {
      expect(clientIp(new Headers(h), 0)).toBe(UNTRUSTED_CLIENT);
    }
  });

  it("reads TRUSTED_PROXY_HOPS with a safe default", () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "0" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: " 2 " })).toBe(2);
    for (const bad of ["-1", "abc", "1.5", "11", "999"]) expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: bad })).toBe(1);
  });
});
