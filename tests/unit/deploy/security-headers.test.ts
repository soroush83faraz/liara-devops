import { describe, expect, it } from "vitest";
import { buildCsp, buildSecurityHeaders } from "@/lib/deploy/security-headers";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("buildCsp", () => {
  const prod = buildCsp(true);
  const dev = buildCsp(false);

  it("production has no unsafe-eval, forbids framing and upgrades insecure requests", () => {
    expect(prod).not.toContain("unsafe-eval");
    expect(directive(prod, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(prod).toContain("upgrade-insecure-requests");
    expect(directive(prod, "default-src")).toBe("default-src 'self'");
    expect(directive(prod, "object-src")).toBe("object-src 'none'");
    expect(directive(prod, "base-uri")).toBe("base-uri 'self'");
    expect(directive(prod, "form-action")).toBe("form-action 'self'");
    expect(directive(prod, "connect-src")).toBe("connect-src 'self'");
    expect(directive(prod, "img-src")).toBe("img-src 'self' data: blob:");
    expect(prod).not.toMatch(/\bws:|\bwss:|\*/);
  });

  it("development relaxes only eval and websockets, and still forbids framing", () => {
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(directive(dev, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });
});

describe("buildSecurityHeaders", () => {
  const map = (production: boolean) => Object.fromEntries(buildSecurityHeaders(production).map((h) => [h.key, h.value]));

  it("sets the full set in production including HSTS", () => {
    const h = map(true);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(h["Content-Security-Policy"]).toBeTruthy();
  });

  it("omits HSTS outside production", () => {
    expect(map(false)["Strict-Transport-Security"]).toBeUndefined();
  });
});
