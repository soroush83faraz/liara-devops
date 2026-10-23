import { describe, expect, it } from "vitest";
import { LiaraError } from "../../../lib/liara";
import { GuardError, parseFlags, UsageError } from "../../../scripts/lib/args";
import { billedAllowed, confirmBilled, EXIT, hasToken, liaraFromEnv } from "../../../scripts/lib/guards";
import { describeError, redactForOutput } from "../../../scripts/lib/output";

describe("parseFlags", () => {
  const spec = { strings: ["scenario", "app"], booleans: ["yes", "create"] };

  it("parses strings and booleans, defaulting booleans to false", () => {
    const f = parseFlags(["--scenario", "healthy", "--app", "x-shop"], spec);
    expect(f.strings).toEqual({ scenario: "healthy", app: "x-shop" });
    expect(f.booleans).toEqual({ yes: false, create: false });
  });

  it("accepts --key=value, a leading `--` and boolean flags", () => {
    const f = parseFlags(["--", "--scenario=crash-loop", "--yes"], spec);
    expect(f.strings.scenario).toBe("crash-loop");
    expect(f.booleans.yes).toBe(true);
  });

  it("rejects unknown flags, positionals and missing values as usage errors", () => {
    expect(() => parseFlags(["--nope"], spec)).toThrow(UsageError);
    expect(() => parseFlags(["stray"], spec)).toThrow(UsageError);
    expect(() => parseFlags(["--scenario"], spec)).toThrow(UsageError);
  });
});

describe("guards", () => {
  it("--create alone is refused; it also needs ALLOW_BILLED_LIVE_TESTS=1", () => {
    expect(() => confirmBilled({ create: false }, { ALLOW_BILLED_LIVE_TESTS: "1" })).toThrow(GuardError);
    expect(() => confirmBilled({ create: true }, {})).toThrow(GuardError);
    expect(() => confirmBilled({ create: true }, { ALLOW_BILLED_LIVE_TESTS: "true" })).toThrow(GuardError);
    expect(() => confirmBilled({ create: true }, { ALLOW_BILLED_LIVE_TESTS: "1" })).not.toThrow();
    expect(billedAllowed({ create: true }, { ALLOW_BILLED_LIVE_TESTS: "1" })).toBe(true);
    expect(billedAllowed({ create: false }, { ALLOW_BILLED_LIVE_TESTS: "1" })).toBe(false);
  });

  it("liaraFromEnv refuses to run without a token and builds a client with one", () => {
    expect(() => liaraFromEnv({})).toThrow(GuardError);
    expect(() => liaraFromEnv({ LIARA_API_TOKEN: "   " })).toThrow(GuardError);
    expect(hasToken({ LIARA_API_TOKEN: "abc" })).toBe(true);
    const c = liaraFromEnv({ LIARA_API_TOKEN: "tok-123456", LIARA_TEAM_ID: "team1" });
    expect(c.teamId).toBe("team1");
  });
});

describe("error reporting", () => {
  it("maps errors to the documented exit codes", () => {
    expect(describeError(new UsageError("x")).exitCode).toBe(EXIT.usage);
    expect(describeError(new GuardError("x")).exitCode).toBe(EXIT.guard);
    const e = new LiaraError({ status: 409, kind: "conflict", code: "busy", message: "Liara POST /x failed (409): busy" });
    const r = describeError(e);
    expect(r.exitCode).toBe(3);
    expect(r.message).toContain("kind=conflict");
    expect(r.message).toContain("code=busy");
  });

  it("redacts secrets in error text and output values", () => {
    const secret = "tok_live_ABCDEFGH12345678";
    const r = describeError(new LiaraError({ status: 500, kind: "server", message: `failed with Authorization: Bearer ${secret}` }), [secret]);
    expect(r.message).not.toContain(secret);
    const out = redactForOutput({ password: "hunter2hunter2", note: `x ${secret}` }, [secret]);
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(out)).not.toContain("hunter2hunter2");
  });
});
