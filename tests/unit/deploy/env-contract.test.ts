import { describe, expect, it } from "vitest";
import { ENV_CONTRACT, validateProductionEnv } from "@/lib/deploy/env-contract";
import { assertProductionConfig } from "@/lib/deploy/startup-check";

const KEY = "k".repeat(48);
const codes = (env: Record<string, string | undefined>) => validateProductionEnv(env).issues.map((i) => i.code);

describe("validateProductionEnv", () => {
  it("passes with a 48 char session key; everything else is advisory", () => {
    const r = validateProductionEnv({ APP_SESSION_KEY: KEY });
    expect(r.ok).toBe(true);
    expect(r.issues.every((i) => i.level === "warn")).toBe(true);
  });

  it("fails when the session key is missing, empty or short", () => {
    for (const value of [undefined, "", "k".repeat(31)]) {
      const r = validateProductionEnv({ APP_SESSION_KEY: value });
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.level === "error" && i.name === "APP_SESSION_KEY")).toBe(true);
    }
    expect(validateProductionEnv({ APP_SESSION_KEY: "k".repeat(32) }).ok).toBe(true);
  });

  it("warns, but does not fail, for a missing approval key", () => {
    expect(codes({ APP_SESSION_KEY: KEY })).toContain("approval_key_unset");
    expect(codes({ APP_SESSION_KEY: KEY, APP_APPROVAL_KEY: "short" })).toContain("approval_key_short");
    expect(codes({ APP_SESSION_KEY: KEY, APP_APPROVAL_KEY: KEY })).not.toContain("approval_key_unset");
  });

  it("treats LLM config as optional: unconfigured and partial are warnings", () => {
    expect(codes({ APP_SESSION_KEY: KEY })).toContain("llm_unconfigured");
    const partial = validateProductionEnv({ APP_SESSION_KEY: KEY, LIARA_AI_BASE_URL: "https://x/v1" });
    expect(partial.ok).toBe(true);
    expect(partial.issues.map((i) => i.code)).toContain("llm_partial");
    const full = codes({ APP_SESSION_KEY: KEY, LIARA_AI_BASE_URL: "https://x/v1", LIARA_AI_API_KEY: "a", LLM_MODEL: "m" });
    expect(full).not.toContain("llm_partial");
    expect(full).not.toContain("llm_unconfigured");
  });

  it("warns when dev/test-only variables are set in production (LIARA_API_BASE_URL is ignored)", () => {
    const r = validateProductionEnv({ APP_SESSION_KEY: KEY, LIARA_API_BASE_URL: "http://127.0.0.1:1", LIARA_API_TOKEN: "t", NEXT_PUBLIC_COPILOT_MOCK: "1" });
    expect(r.ok).toBe(true);
    const names = r.issues.filter((i) => i.code === "ignored_in_production").map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["LIARA_API_BASE_URL", "LIARA_API_TOKEN", "NEXT_PUBLIC_COPILOT_MOCK"]));
  });

  it("never puts a value in a message", () => {
    const secret = "S3cr3t-Value-That-Must-Not-Leak-123456";
    const r = validateProductionEnv({ APP_SESSION_KEY: "zzshortvalue", APP_APPROVAL_KEY: secret.slice(0, 10), LIARA_API_TOKEN: secret, LIARA_AI_API_KEY: secret });
    for (const i of r.issues) {
      expect(i.message).not.toContain(secret);
      expect(i.message).not.toContain("zzshortvalue");
      expect(i.message).toMatch(/^[\x20-\x7e]+$/); // English / ASCII machine messages
    }
  });
});

describe("ENV_CONTRACT", () => {
  it("has unique names, documents every entry and marks credentials secret", () => {
    const names = ENV_CONTRACT.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const e of ENV_CONTRACT) expect(e.description.length).toBeGreaterThan(10);
    for (const n of ["APP_SESSION_KEY", "APP_APPROVAL_KEY", "LIARA_AI_API_KEY", "FALLBACK_AI_API_KEY", "LIARA_API_TOKEN"]) {
      expect(ENV_CONTRACT.find((e) => e.name === n)?.secret).toBe(true);
    }
    expect(ENV_CONTRACT.filter((e) => e.requiredInProduction).map((e) => e.name)).toEqual(["APP_SESSION_KEY"]);
  });
});

describe("assertProductionConfig", () => {
  it("throws in production with names only, and is a no-op elsewhere", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "production", APP_SESSION_KEY: "short" })).toThrow(/APP_SESSION_KEY/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", APP_SESSION_KEY: KEY })).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: "development" })).not.toThrow();
    try {
      assertProductionConfig({ NODE_ENV: "production", APP_SESSION_KEY: "short" });
    } catch (e) {
      expect((e as Error).message).not.toContain("short,");
    }
  });
});
