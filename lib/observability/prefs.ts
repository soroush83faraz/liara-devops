// Which services the dashboard hides, remembered per account on this device (same approach as the canvas layout in
// lib/canvas/layout.ts: localStorage only, every access wrapped in try/catch, malformed data dropped).
const ID_RE = /^[\w.:@-]{1,128}$/;
const MAX_HIDDEN = 500;

export const hiddenStorageKey = (accountId: string): string => `hamyar:observability:hidden:${accountId}`;

/** Validates data read from storage: a list of service ids, anything else is dropped. */
export function sanitizeHidden(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v === "string" && ID_RE.test(v)) out.add(v);
    if (out.size >= MAX_HIDDEN) break;
  }
  return [...out];
}

export function loadHidden(accountId: string): string[] {
  try {
    const raw = window.localStorage.getItem(hiddenStorageKey(accountId));
    return raw ? sanitizeHidden(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveHidden(accountId: string, hidden: readonly string[]): void {
  try {
    if (hidden.length === 0) window.localStorage.removeItem(hiddenStorageKey(accountId));
    else window.localStorage.setItem(hiddenStorageKey(accountId), JSON.stringify(sanitizeHidden([...hidden])));
  } catch {
    // storage unavailable: the choice simply is not remembered
  }
}
