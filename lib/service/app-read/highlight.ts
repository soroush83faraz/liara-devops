export interface Segment {
  text: string;
  match: boolean;
}

export type Matcher = { ok: true; re: RegExp } | { ok: false } | null;

const MAX_PATTERN = 200;

/** Builds a case-insensitive matcher. Plain text is escaped; `useRegex` accepts a user regex (length-capped). Empty query => null. */
export function buildMatcher(query: string, useRegex: boolean): Matcher {
  if (!query) return null;
  if (query.length > MAX_PATTERN) return { ok: false };
  try {
    const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { ok: true, re: new RegExp(source, "gi") };
  } catch {
    return { ok: false };
  }
}

/** Splits `text` into plain / matching segments. Pure text only: callers render segments as React text nodes. */
export function splitHighlight(text: string, matcher: Matcher): Segment[] {
  if (!matcher || !matcher.ok) return [{ text, match: false }];
  const out: Segment[] = [];
  const re = new RegExp(matcher.re.source, matcher.re.flags.includes("g") ? matcher.re.flags : `${matcher.re.flags}g`);
  let last = 0;
  let guard = 0;
  for (let m = re.exec(text); m && guard < 500; m = re.exec(text), guard++) {
    if (m[0] === "") {
      re.lastIndex++; // zero-width match: avoid an infinite loop
      continue;
    }
    if (m.index > last) out.push({ text: text.slice(last, m.index), match: false });
    out.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.length ? out : [{ text, match: false }];
}

export function matches(text: string, matcher: Matcher): boolean {
  if (!matcher) return true;
  if (!matcher.ok) return true;
  matcher.re.lastIndex = 0;
  const hit = matcher.re.test(text);
  matcher.re.lastIndex = 0;
  return hit;
}
