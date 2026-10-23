import { afterEach, describe, expect, it } from "vitest";
import { ACTION_POLICY, ACTION_TYPES } from "../../../lib/contracts/action";
import {
  PolicyError,
  assertAiMayPropose,
  assertRateLimit,
  assertSameOrigin,
  assertTypedName,
  checkSameOrigin,
  rateLimit,
  requiredConfirmation,
} from "../../../lib/security/policy";

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe("action gates", () => {
  it("only aiProposable types pass assertAiMayPropose", () => {
    for (const t of ACTION_TYPES) {
      if (ACTION_POLICY[t].aiProposable) expect(() => assertAiMayPropose(t)).not.toThrow();
      else expect(() => assertAiMayPropose(t), t).toThrow(expect.objectContaining({ code: "ai_not_allowed" }));
    }
    for (const bad of ["drop_db", "DELETE_APP", "", "__proto__", "toString", 1, null, undefined, {}]) {
      expect(() => assertAiMayPropose(bad), String(bad)).toThrow(expect.objectContaining({ code: "unknown_action" }));
    }
  });

  it("derives confirmation requirements from the policy table", () => {
    expect(requiredConfirmation("restart")).toEqual({ tier: 1, typedName: false, costLine: false, reversible: "yes" });
    expect(requiredConfirmation("resize")).toMatchObject({ tier: 2, typedName: true, costLine: true });
    expect(requiredConfirmation("delete_db")).toMatchObject({ tier: 3, typedName: true, costLine: false, reversible: "no" });
    expect(() => requiredConfirmation("nope" as never)).toThrow(PolicyError);
  });

  it("typed names must match exactly (trim only)", () => {
    expect(() => assertTypedName("shop", "shop")).not.toThrow();
    expect(() => assertTypedName("  shop\n", "shop")).not.toThrow();
    for (const bad of ["Shop", "SHOP", "shop2", "sho", "s hop", "shop​", "​shop", "ѕhop", "", "  ", "shop-db", null, 5, ["shop"], "x".repeat(600)]) {
      expect(() => assertTypedName(bad, "shop"), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: "typed_name_mismatch" }));
    }
    expect(() => assertTypedName("", "")).toThrow(TypeError);
    expect(() => assertTypedName(" shop", " shop")).toThrow(TypeError);
  });
});

describe("same-origin check", () => {
  const saved = process.env.APP_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = saved;
  });

  it("accepts same-origin browser requests", () => {
    expect(checkSameOrigin(req({ origin: "https://hamyar.liara.run", host: "hamyar.liara.run" }))).toEqual({ ok: true });
    expect(checkSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": "same-origin" }))).toEqual({ ok: true });
    expect(checkSameOrigin(req({ origin: "https://hamyar.liara.run", host: "hamyar.liara.run:443" }))).toEqual({ ok: true });
    expect(checkSameOrigin(req({ origin: "https://hamyar.liara.run", host: "10.0.0.5:3000", "x-forwarded-host": "hamyar.liara.run" }))).toEqual({
      ok: true,
    });
    expect(checkSameOrigin(req({ "sec-fetch-site": "same-origin" }))).toEqual({ ok: true });
    expect(checkSameOrigin(req({ "sec-fetch-site": "none" }))).toEqual({ ok: true });
  });

  it("rejects cross-site, sibling-subdomain and malformed origins", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ origin: "https://evil.example", host: "hamyar.liara.run" }, "origin_mismatch"],
      [{ origin: "https://other-app.liara.run", host: "hamyar.liara.run", "sec-fetch-site": "same-site" }, "cross_site"],
      [{ origin: "https://hamyar.liara.run", host: "hamyar.liara.run", "sec-fetch-site": "cross-site" }, "cross_site"],
      [{ origin: "https://hamyar.liara.run", host: "hamyar.liara.run", "sec-fetch-site": "same-site" }, "cross_site"],
      [{ origin: "null", host: "hamyar.liara.run" }, "bad_origin"],
      [{ origin: "https://hamyar.liara.run/path", host: "hamyar.liara.run" }, "bad_origin"],
      [{ origin: "https://user:pass@hamyar.liara.run", host: "hamyar.liara.run" }, "bad_origin"],
      [{ origin: "ftp://hamyar.liara.run", host: "hamyar.liara.run" }, "bad_origin"],
      [{ origin: "https://hamyar.liara.run:8443", host: "hamyar.liara.run" }, "origin_mismatch"],
      [{ origin: "https://hamyar.liara.run.evil.example", host: "hamyar.liara.run" }, "origin_mismatch"],
      [{ origin: "https://hamyar.liara.run" }, "missing_host"],
      [{ host: "hamyar.liara.run" }, "missing_origin"],
      [{}, "missing_origin"],
      [{ host: "hamyar.liara.run", "sec-fetch-site": "cross-site" }, "cross_site"],
    ];
    for (const [headers, reason] of cases) {
      expect(checkSameOrigin(req(headers)), JSON.stringify(headers)).toEqual({ ok: false, reason });
    }
  });

  it("APP_ORIGIN is an exact allowlist that overrides Host matching", () => {
    process.env.APP_ORIGIN = "https://hamyar.liara.run";
    expect(checkSameOrigin(req({ origin: "https://hamyar.liara.run", host: "whatever" }))).toEqual({ ok: true });
    expect(checkSameOrigin(req({ origin: "https://evil.example", host: "evil.example" }))).toEqual({ ok: false, reason: "origin_mismatch" });
    expect(checkSameOrigin(req({ origin: "https://evil.example", host: "evil.example" }), { allowedOrigins: ["https://evil.example"] })).toEqual({
      ok: true,
    });
  });

  it("assertSameOrigin throws a generic error with a non-enumerable detail", () => {
    try {
      assertSameOrigin(req({ origin: "https://evil.example", host: "hamyar.liara.run" }));
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyError);
      expect((e as PolicyError).code).toBe("cross_origin");
      expect((e as PolicyError).detail).toBe("origin_mismatch");
      expect(Object.keys(e as object)).not.toContain("detail");
    }
  });
});

describe("rate limit", () => {
  it("allows `limit` hits per sliding window", () => {
    const key = `test:${Math.random()}`;
    const t = 1_000_000;
    expect(rateLimit(key, 3, 1000, t).ok).toBe(true);
    expect(rateLimit(key, 3, 1000, t + 100).ok).toBe(true);
    expect(rateLimit(key, 3, 1000, t + 200)).toEqual({ ok: true, limit: 3, remaining: 0, retryAfterMs: 0 });
    expect(rateLimit(key, 3, 1000, t + 300)).toEqual({ ok: false, limit: 3, remaining: 0, retryAfterMs: 700 });
    expect(rateLimit(key, 3, 1000, t + 1000).ok).toBe(true); // first hit slid out
    expect(rateLimit(`${key}:other`, 3, 1000, t + 300).ok).toBe(true);
    expect(() => assertRateLimit(key, 1, 1000, t + 1001)).toThrow(expect.objectContaining({ code: "rate_limited" }));
  });

  it("validates its arguments", () => {
    expect(() => rateLimit("", 1, 1000)).toThrow(TypeError);
    expect(() => rateLimit("k", 0, 1000)).toThrow(RangeError);
    expect(() => rateLimit("k", 1.5, 1000)).toThrow(RangeError);
    expect(() => rateLimit("k", 1, 0)).toThrow(RangeError);
  });
});
