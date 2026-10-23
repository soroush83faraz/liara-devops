import { fa } from "./fa";
import { isolateValue, statusCode } from "./bidi";
import { faNumber, faPlain } from "./format";

type Leaves<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
    }[keyof T & string];

/** Dotted path to any string leaf of the dictionary, e.g. "connect.bullets.one". */
export type TKey = Leaves<typeof fa>;
export type TParams = Record<string, string | number>;

function lookup(path: string): string | undefined {
  let node: unknown = fa;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Params that name identifiers, not quantities: never grouped («۳۰۰۰», not «۳٬۰۰۰»). */
const PLAIN_PARAMS = new Set(["port", "year", "id"]);
/** Params that carry HTTP status / machine codes: Latin digits, LTR-isolated (301, 500, 2xx). */
const CODE_PARAMS = new Set(["status", "httpStatus", "code"]);
const DIGITS_ONLY = /^(\d+|\dxx)$/i;

function renderParam(name: string, value: string | number): string {
  const numeric = typeof value === "number" || DIGITS_ONLY.test(value);
  if (numeric && CODE_PARAMS.has(name)) return statusCode(value);
  if (numeric && PLAIN_PARAMS.has(name)) return faPlain(value);
  if (typeof value === "number") return faNumber(value);
  return isolateValue(value);
}

/**
 * Translate a dictionary key. `{name}` placeholders are replaced from `params`;
 * numeric params are rendered with Persian digits automatically (ports/years/ids without grouping,
 * status codes as isolated Latin digits). A missing key returns the key itself
 * (visible in the UI and caught by the i18n unit test, never thrown).
 */
export function t(path: TKey, params?: TParams): string {
  const raw = lookup(path);
  if (raw === undefined) return path;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : renderParam(name, value);
  });
}

/** Hook form of `t` (the dictionary is static today; the hook keeps call sites ready for locale switching). */
export function useT(): typeof t {
  return t;
}
