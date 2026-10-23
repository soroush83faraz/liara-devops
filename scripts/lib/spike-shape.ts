import { redactString } from "../../lib/security/redact";

/**
 * Structural summaries of Liara responses for the committed spike report.
 * They contain key names, JSON types, format hints (iso8601 / numeric / unix-s|ms|ns), counts and the
 * values of an explicit allowlist of enum-like fields (status, state, ...). Free text is never emitted.
 */
export type Shape = string | { [k: string]: Shape | number | string[] };

/** Fields whose string values are enum-like (and therefore worth recording to answer the [VAL] enum questions). */
export const ENUM_KEYS: ReadonlySet<string> = new Set([
  "status", "state", "type", "stream", "platform", "reason", "certificatesStatus", "fixedIPStatus", "region", "direction",
  "level", "kind", "planID", "bundlePlanID", "finish_reason", "role", "failReason",
]);
const SAFE_ENUM = /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/;
const SAFE_KEY = /^[A-Za-z0-9_.$@:-]{1,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/;
const NUMERIC = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const TIME_KEY = /^(?:t|ts|time|timestamp|datetime|since|start|end)$|(?:At|_at|Time|time)$/;
const MAX_ENUM = 25;
const MAX_KEYS = 60;
const MAX_ITEMS = 25;

const isObj = (s: unknown): s is Record<string, Shape | number | string[]> => typeof s === "object" && s !== null && !Array.isArray(s);

function scalar(v: unknown, key: string): Shape {
  if (v === null) return "null";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") {
    if (Number.isInteger(v) && TIME_KEY.test(key)) {
      const digits = String(Math.abs(v)).length;
      if (digits === 10) return "number:unix-s";
      if (digits === 13) return "number:unix-ms";
      if (digits === 19) return "number:unix-ns";
    }
    return "number";
  }
  if (typeof v === "string") {
    if (ISO.test(v)) return "string:iso8601";
    if (NUMERIC.test(v)) return "string:numeric";
    if (ENUM_KEYS.has(key) && SAFE_ENUM.test(v) && redactString(v) === v) return { _enum: [v] };
    return "string";
  }
  return typeof v;
}

const enumOf = (s: Shape | number | string[] | undefined): string[] | undefined => (isObj(s) && Array.isArray(s._enum) ? s._enum : undefined);

/** Merge two shapes of the same field (e.g. items of one array) into one. */
export function mergeShapes(a: Shape, b: Shape): Shape {
  if (typeof a === "string" && typeof b === "string") return a === b || a.split("|").includes(b) ? a : `${a}|${b}`;
  const ea = enumOf(a);
  const eb = enumOf(b);
  if ((ea || a === "string") && (eb || b === "string")) return { _enum: [...new Set([...(ea ?? []), ...(eb ?? [])])].sort().slice(0, MAX_ENUM) };
  if (isObj(a) && isObj(b) && !ea && !eb) {
    const out: Record<string, Shape | number | string[]> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      const cur = out[k];
      out[k] = cur === undefined ? v : typeof cur === "number" || typeof v === "number" || Array.isArray(cur) || Array.isArray(v) ? (k === "_len" ? Math.max(Number(cur), Number(v)) : cur) : mergeShapes(cur, v);
    }
    return out;
  }
  return "mixed";
}

export function shapeOf(value: unknown, key = "", depth = 7): Shape {
  if (depth <= 0) return "…";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS);
    const allScalar = items.length > 0 && items.every((x) => x === null || typeof x !== "object");
    const mixed = allScalar && value.length <= 4 && new Set(items.map((x) => typeof x)).size > 1;
    if (mixed) return { _tuple: items.map((x, i) => scalarOrDeep(x, i === 0 ? "t" : key)) } as unknown as Shape;
    const merged = items.map((x) => shapeOf(x, key, depth - 1)).reduce<Shape | undefined>((acc, s) => (acc === undefined ? s : mergeShapes(acc, s)), undefined);
    return { _len: value.length, ...(merged === undefined ? {} : { _items: merged }) } as Shape;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, Shape> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      const safe = SAFE_KEY.test(k) && redactString(k) === k ? k : "<key>";
      const s = shapeOf(v, k, depth - 1);
      out[safe] = safe in out ? mergeShapes(out[safe], s) : s;
    }
    return out;
  }
  return scalar(value, key);
}

const scalarOrDeep = (v: unknown, key: string): Shape => (v !== null && typeof v === "object" ? shapeOf(v, key) : scalar(v, key));

/** Distinct, safe enum-like values of `key` found anywhere in `items` (one level of objects). */
export function distinctValues(items: ReadonlyArray<unknown>, key: string): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const v = it !== null && typeof it === "object" ? (it as Record<string, unknown>)[key] : undefined;
    if (typeof v === "string" && SAFE_ENUM.test(v) && redactString(v) === v) set.add(v);
    else if (typeof v === "number" || typeof v === "boolean") set.add(String(v));
  }
  return [...set].sort().slice(0, MAX_ENUM);
}
