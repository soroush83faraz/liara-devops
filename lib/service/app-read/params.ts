/** Validation of path/query params shared by the read routes. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isValidAppName = (v: string): boolean => NAME_RE.test(v);
export const isValidReleaseId = (v: string): boolean => ID_RE.test(v);

/** Integer query param within [min, max]; falls back to `def` for missing/invalid input. */
export function intParam(v: string | null, def: number, min: number, max: number): number {
  if (v === null || v.trim() === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** `since` accepts unix seconds, unix milliseconds or an ISO-8601 string; returns unix seconds (floored) or undefined. */
export function parseSinceSec(v: string | null): number | undefined {
  if (v === null || v.trim() === "") return undefined;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.floor(n > 1e11 ? n / 1000 : n);
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}
