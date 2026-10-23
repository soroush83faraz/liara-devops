// All inputs are SYNTHETIC (made up for these tests); nothing here was recorded from Liara.
import { describe, expect, it } from "vitest";
import { ActionParamsSchema } from "../../../lib/contracts";
import {
  buildEnvDiff,
  buildSetEnvRequest,
  envKeyIssue,
  envValueIssue,
  isPublicEnvKey,
  isValidEnvKey,
  MAX_ENV_CHANGES,
  parseDotenv,
} from "../../../lib/service/app-config/env-parse";

describe("env key validation", () => {
  it.each(["A", "_x", "DATABASE_URL", "a1_b2", "NEXT_PUBLIC_API"])("accepts %s", (k) => expect(isValidEnvKey(k)).toBe(true));
  it.each([
    ["", "empty"],
    ["1ABC", "bad_chars"],
    ["MY-KEY", "bad_chars"],
    ["MY KEY", "bad_chars"],
    ["a.b", "bad_chars"],
    ["ключ", "bad_chars"],
    ["A".repeat(129), "too_long"],
    ["__proto__", "reserved"],
    ["constructor", "reserved"],
  ])("rejects %j as %s", (k, issue) => expect(envKeyIssue(k)).toBe(issue));

  it("flags browser-exposed prefixes case-insensitively", () => {
    for (const k of ["NEXT_PUBLIC_X", "vite_api", "REACT_APP_Y", "EXPO_PUBLIC_Z", "PUBLIC_W"]) expect(isPublicEnvKey(k)).toBe(true);
    for (const k of ["DATABASE_URL", "PUBLISHER", "SECRET"]) expect(isPublicEnvKey(k)).toBe(false);
  });

  it("flags oversized values and NUL", () => {
    expect(envValueIssue("a".repeat(16_385))).toBe("too_long");
    expect(envValueIssue("a\u0000b")).toBe("nul");
    expect(envValueIssue("ok")).toBeNull();
  });
});

describe("parseDotenv", () => {
  it("parses plain, export, quoted values, comments and CRLF", () => {
    const text = [
      "# comment",
      "",
      "A=1",
      "export B=two words",
      'C="quoted # not a comment"',
      "D='single $raw'",
      "E=value # trailing comment",
      'F="x" # c',
      "G=",
      "H=a=b=c",
    ].join("\r\n");
    const r = parseDotenv(text);
    expect(r.issues).toEqual([]);
    expect(Object.fromEntries(r.entries.map((e) => [e.key, e.value]))).toEqual({
      A: "1",
      B: "two words",
      C: "quoted # not a comment",
      D: "single $raw",
      E: "value",
      F: "x",
      G: "",
      H: "a=b=c",
    });
    expect(r.entries.find((e) => e.key === "B")?.line).toBe(4);
  });

  it("unescapes only \\\" and \\\\ in double quotes and keeps \\n literal", () => {
    const r = parseDotenv('K="a\\"b\\\\c\\nd"');
    expect(r.entries[0].value).toBe('a"b\\c\\nd');
  });

  it("keeps the last duplicate and reports a warning", () => {
    const r = parseDotenv("A=1\nB=2\nA=3");
    expect(r.entries.map((e) => [e.key, e.value])).toEqual([
      ["A", "3"],
      ["B", "2"],
    ]);
    expect(r.issues).toEqual([{ line: 3, code: "duplicate", severity: "warning", key: "A" }]);
  });

  it("rejects multi-line quoted values and swallows their continuation lines", () => {
    const r = parseDotenv('KEY="-----BEGIN\nBAD=continuation\n-----END"\nOK=1');
    expect(r.entries.map((e) => e.key)).toEqual(["OK"]);
    expect(r.issues).toEqual([{ line: 1, code: "multiline", severity: "error" }]);
  });

  it("reports invalid keys, missing '=', junk after a quote, NUL and long values; never echoes values", () => {
    const secret = "SYNTH-SECRET-VALUE";
    const text = [`1BAD=${secret}`, `no equals ${secret}`, `K="a" ${secret}`, "N=a\u0000b", `L=${"x".repeat(16_385)}`, "GOOD=1"].join("\n");
    const r = parseDotenv(text);
    expect(r.entries.map((e) => e.key)).toEqual(["GOOD"]);
    expect(r.issues.map((i) => i.code)).toEqual(["invalid_key", "no_equals", "bad_quote", "nul", "value_too_long"]);
    expect(JSON.stringify(r.issues)).not.toContain(secret);
  });

  it("strips a BOM and handles empty input", () => {
    expect(parseDotenv("﻿A=1").entries).toHaveLength(1);
    expect(parseDotenv("").entries).toEqual([]);
    expect(parseDotenv("   \n# only comments").issues).toEqual([]);
  });

  it("does not treat __proto__ as a key", () => {
    const r = parseDotenv("__proto__=x");
    expect(r.entries).toEqual([]);
    expect(r.issues[0].code).toBe("invalid_key");
  });
});

describe("buildEnvDiff", () => {
  it("classifies add vs overwrite and flags public prefixes; untouched keys are not listed", () => {
    const d = buildEnvDiff(["A", "OLD"], [{ key: "A" }, { key: "NEXT_PUBLIC_B" }, { key: "C" }]);
    expect(d.items).toEqual([
      { key: "A", kind: "overwrite", publicPrefix: false },
      { key: "NEXT_PUBLIC_B", kind: "add", publicPrefix: true },
      { key: "C", kind: "add", publicPrefix: false },
    ]);
    expect(d.added).toBe(2);
    expect(d.overwritten).toBe(1);
    expect(d.overLimit).toBe(false);
  });

  it("marks more than the per-operation limit", () => {
    const entries = Array.from({ length: MAX_ENV_CHANGES + 1 }, (_, i) => ({ key: `K${i}` }));
    expect(buildEnvDiff([], entries).overLimit).toBe(true);
  });
});

describe("buildSetEnvRequest", () => {
  it("keeps values out of params (valueSource 'user') and passes the contract schema", () => {
    const secret = "SYNTH-PW-1234";
    const req = buildSetEnvRequest("demo-shop", [
      { key: "DB_PASSWORD", value: secret },
      { key: "MODE", value: "prod" },
    ]);
    expect(JSON.stringify(req.params)).not.toContain(secret);
    expect(req.params.changes).toEqual([
      { op: "set", key: "DB_PASSWORD", valueSource: "user" },
      { op: "set", key: "MODE", valueSource: "user" },
    ]);
    expect(req.userValues).toEqual({ DB_PASSWORD: secret, MODE: "prod" });
    expect(ActionParamsSchema.safeParse(req.params).success).toBe(true);
  });
});
