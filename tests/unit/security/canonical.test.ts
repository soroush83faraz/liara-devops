import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanonicalJsonError, canonicalJson, fingerprintState, hashParams } from "../../../lib/security/canonical";

describe("canonicalJson", () => {
  it("is independent of key order and recursive", () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: "z" } };
    const b = { a: { c: "z", d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"z","d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it("keeps array order and distinguishes types", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: "1" })).not.toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
    expect(canonicalJson({ a: undefined })).toBe(canonicalJson({}));
    expect(canonicalJson("é")).not.toBe(canonicalJson("é"));
  });

  it("rejects values without one unambiguous JSON form", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = 1;
    for (let i = 0; i < 70; i++) deep = [deep];
    class Thing {
      x = 1;
    }
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      BigInt(1),
      () => 1,
      Symbol("s"),
      undefined,
      new Date(0),
      new Map(),
      new Set(),
      new Thing(),
      [1, undefined],
      [1, , 3],
      cyclic,
      deep,
      { a: Number.NaN },
    ]) {
      expect(() => canonicalJson(bad), String(bad)).toThrow(CanonicalJsonError);
    }
  });

  it("accepts null-prototype objects and JSON-parsed __proto__ keys deterministically", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 1;
    o.a = 2;
    expect(canonicalJson(o)).toBe('{"a":2,"b":1}');
    const parsed = JSON.parse('{"__proto__": {"x": 1}, "a": 1}') as unknown;
    expect(canonicalJson(parsed)).toBe('{"__proto__":{"x":1},"a":1}');
  });
});

describe("hashes", () => {
  it("are domain-separated sha256 over canonical JSON", () => {
    const expected = createHash("sha256").update('hamyar.params.v1\n{"a":1}').digest("hex");
    expect(hashParams({ a: 1 })).toBe(expected);
    expect(fingerprintState({ a: 1 })).not.toBe(hashParams({ a: 1 }));
    expect(hashParams({ b: [1, 2], a: "x" })).toBe(hashParams({ a: "x", b: [1, 2] }));
    expect(hashParams({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});
