// S5 regression: the connect endpoint's limiter trusted the FIRST X-Forwarded-For entry, so rotating a spoofed
// leftmost entry bypassed it, and nothing bounded attempts spread over many addresses.
// S10 regression: outside production LIARA_API_BASE_URL accepted ANY https host (the user's token would go there).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOBAL_SESSION_ATTEMPTS_PER_MINUTE, SESSION_ATTEMPTS_PER_MINUTE } from "@/app/api/session/rate-limit";
import { liaraBaseUrl } from "@/lib/server/liara-base";

const attempt = (xff: string) =>
  new Request("http://localhost/api/session", {
    method: "POST",
    body: JSON.stringify({ token: "abcdefghijkl" }),
    headers: { "content-type": "application/json", "x-forwarded-for": xff },
  });

beforeEach(() => {
  vi.resetModules(); // fresh limiter state per test
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/session rate limiting", () => {
  it("rotating spoofed leftmost X-Forwarded-For entries share the proxy-appended client's bucket", async () => {
    const { POST } = await import("@/app/api/session/route");
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) statuses.push((await POST(attempt(`10.0.${i}.${i}, 172.16.${i}.1, 198.51.100.77`))).status);
    expect(statuses.filter((s) => s !== 429)).toHaveLength(SESSION_ATTEMPTS_PER_MINUTE);
    expect(statuses.slice(SESSION_ATTEMPTS_PER_MINUTE).every((s) => s === 429)).toBe(true);
  });

  it("a global circuit bounds attempts spread over many client addresses", async () => {
    const { POST } = await import("@/app/api/session/route");
    let allowed = 0;
    for (let i = 0; i < GLOBAL_SESSION_ATTEMPTS_PER_MINUTE + 40; i++) {
      const res = await POST(attempt(`198.51.${Math.floor(i / 250)}.${i % 250}`));
      if (res.status !== 429) allowed++;
      else expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    }
    expect(allowed).toBe(GLOBAL_SESSION_ATTEMPTS_PER_MINUTE);
  });

  it("TRUSTED_PROXY_HOPS=0 ignores X-Forwarded-For entirely", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    const { POST } = await import("@/app/api/session/route");
    let allowed = 0;
    for (let i = 0; i < 15; i++) if ((await POST(attempt(`203.0.113.${i}`))).status !== 429) allowed++;
    expect(allowed).toBe(SESSION_ATTEMPTS_PER_MINUTE);
  });
});

describe("TRUSTED_PROXY_HOPS in the env contract", () => {
  it("is documented and an invalid value is a warning, not a failure", async () => {
    const { ENV_CONTRACT, validateProductionEnv } = await import("@/lib/deploy/env-contract");
    expect(ENV_CONTRACT.find((e) => e.name === "TRUSTED_PROXY_HOPS")).toMatchObject({ scope: "runtime", secret: false });
    const KEY = "k".repeat(48);
    for (const bad of ["abc", "-1", "11", "1.5"]) {
      const r = validateProductionEnv({ APP_SESSION_KEY: KEY, TRUSTED_PROXY_HOPS: bad });
      expect(r.ok).toBe(true);
      expect(r.issues.map((i) => i.code)).toContain("trusted_proxy_hops_invalid");
    }
    for (const good of ["0", "1", "2", "10", ""]) {
      expect(validateProductionEnv({ APP_SESSION_KEY: KEY, TRUSTED_PROXY_HOPS: good }).issues.map((i) => i.code)).not.toContain("trusted_proxy_hops_invalid");
    }
  });
});

describe("liaraBaseUrl: the override is loopback-only and never applies in production", () => {
  const DEFAULT = "https://api.liara.ir";
  const cases: Array<[string, string, string]> = [
    ["development", "https://evil.example", DEFAULT],
    ["test", "https://api.attacker.example:8443", DEFAULT],
    ["development", "http://evil.example", DEFAULT],
    ["development", "https://127.0.0.1.nip.io", DEFAULT],
    ["development", "http://localhost.evil.example:4010", DEFAULT],
    ["development", "http://user:pw@127.0.0.1:4010", DEFAULT],
    ["development", "file:///etc/passwd", DEFAULT],
    ["development", "not a url", DEFAULT],
    ["production", "http://127.0.0.1:4010", DEFAULT],
    ["production", "http://localhost:4010", DEFAULT],
    ["development", "http://127.0.0.1:4010", "http://127.0.0.1:4010"],
    ["test", "http://localhost:4010/ignored/path", "http://localhost:4010"],
    ["development", "http://[::1]:4010", "http://[::1]:4010"],
    ["development", "https://LOCALHOST:8443", "https://localhost:8443"],
  ];
  for (const [nodeEnv, override, expected] of cases) {
    it(`${nodeEnv}: ${override} -> ${expected}`, () => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("LIARA_API_BASE_URL", override);
      expect(liaraBaseUrl()).toBe(expected);
    });
  }
});
