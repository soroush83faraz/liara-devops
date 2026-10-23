import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, JSON
 * escaping for strings. Rejects anything without a single unambiguous JSON form
 * (non-finite numbers, bigint, functions, symbols, undefined in arrays, sparse
 * arrays, cycles, non-plain objects such as Date/Map/class instances), so two
 * different values can never canonicalize to the same string.
 */

export class CanonicalJsonError extends Error {
  readonly code = "canonical_json_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

const MAX_DEPTH = 64;

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function encode(value: unknown, depth: number, stack: Set<object>): string {
  if (depth > MAX_DEPTH) throw new CanonicalJsonError("value nested too deeply");
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalJsonError("non-finite number");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(`unsupported type ${typeof value}`);
  }
  const obj = value as object;
  if (stack.has(obj)) throw new CanonicalJsonError("cycle");
  stack.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(obj, i)) throw new CanonicalJsonError("sparse array");
        const item: unknown = obj[i];
        if (item === undefined) throw new CanonicalJsonError("undefined in array");
        parts.push(encode(item, depth + 1, stack));
      }
      return `[${parts.join(",")}]`;
    }
    if (!isPlainObject(obj)) throw new CanonicalJsonError("non-plain object");
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = record[k];
      if (v === undefined) continue; // same as JSON: absent and undefined are equal
      parts.push(`${JSON.stringify(k)}:${encode(v, depth + 1, stack)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    stack.delete(obj);
  }
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new CanonicalJsonError("undefined");
  return encode(value, 0, new Set());
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Hash binding approval tokens and proposals to exact params (domain-separated). */
export function hashParams(params: unknown): string {
  return sha256Hex(`hamyar.params.v1\n${canonicalJson(params)}`);
}

/** Fingerprint of the Liara state a proposal was based on; recompute at confirm time. */
export function fingerprintState(state: unknown): string {
  return sha256Hex(`hamyar.state.v1\n${canonicalJson(state)}`);
}
