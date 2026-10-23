// Bidi helpers with no dependencies (the dictionary itself uses them, so this file must not import it).

/** Unicode bidi isolates: wrap a run so it keeps its own direction and does not reorder its neighbours. */
export const LRI = "\u2066";
export const PDI = "\u2069";

const LATIN_TOKEN = /[A-Za-z0-9_.\-:/*=+@#%&?~<>]+/g;
const HAS_PERSIAN = /[\u0600-\u06FF]/;
const HAS_LATIN_LETTER = /[A-Za-z]/;
/** Characters that separate Latin items inside a Persian list: «tk، ml، ga». */
const LIST_GAP = /^[\s\u060C\u061B,;]*[\u060C\u061B,;][\s\u060C\u061B,;]*$/;

function isolateSegment(seg: string): string {
  const found: Array<{ start: number; end: number }> = [];
  for (const m of seg.matchAll(LATIN_TOKEN)) {
    let text = m[0];
    // A sentence's own closing punctuation is not part of the token.
    const trail = /[.:,;!?]+$/.exec(text);
    if (trail && text.length > trail[0].length && HAS_LATIN_LETTER.test(text)) text = text.slice(0, -trail[0].length);
    if (!HAS_LATIN_LETTER.test(text) && !text.includes("*")) continue;
    found.push({ start: m.index, end: m.index + text.length });
  }
  const edge = (i: number) => {
    const text = seg.slice(found[i]!.start, found[i]!.end);
    // A leading digit would be read as an Arabic number after Persian text («مثلاً 5f3a9c»), so it is an edge too.
    return !/^[A-Za-z]/.test(text) || !/[A-Za-z0-9]$/.test(text);
  };
  const wrap = found.map((_, i) => {
    if (edge(i)) return true; // ".env", "/data", "https://", "NEXT_PUBLIC_", "<PASSWORD>", "*."
    const prev = found[i - 1];
    const next = found[i + 1];
    // Latin items in a Persian list ("tk، ml، ga") would otherwise merge into one left-to-right run.
    return (!!prev && LIST_GAP.test(seg.slice(prev.end, found[i]!.start))) || (!!next && LIST_GAP.test(seg.slice(found[i]!.end, next.start)));
  });
  let out = "";
  let at = 0;
  found.forEach((f, i) => {
    out += seg.slice(at, f.start);
    out += wrap[i] ? `${LRI}${seg.slice(f.start, f.end)}${PDI}` : seg.slice(f.start, f.end);
    at = f.end;
  });
  return out + seg.slice(at);
}

/**
 * Makes Latin/code fragments inside a Persian sentence render correctly in RTL: «از .env» must not turn
 * into «از env.». Fragments that begin or end with punctuation (.env, /data, https://, NEXT_PUBLIC_, <X>) and
 * Latin items of a Persian list get Unicode isolates (U+2066..U+2069). `{param}` placeholders are left alone.
 * Strings without Persian letters (identifiers, regex sources) and already-isolated strings are returned as is.
 */
export function isolateLatin(text: string): string {
  if (!HAS_PERSIAN.test(text) || text.includes(LRI)) return text;
  return text
    .split(/(\{\w+\})/)
    .map((part) => (part.startsWith("{") && /^\{\w+\}$/.test(part) ? part : isolateSegment(part)))
    .join("");
}

/** Removes the isolates again, for text that leaves the UI (clipboard, downloads, logs). */
export function stripIsolates(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, "");
}

/** A dynamic value (file name, path, URL) dropped into a Persian sentence: isolate it when its edges are punctuation. */
export function isolateValue(value: string): string {
  if (!HAS_LATIN_LETTER.test(value) || value.includes(LRI)) return value;
  const v = value.trim();
  return /^[A-Za-z0-9]/.test(v) && /[A-Za-z0-9]$/.test(v) ? value : `${LRI}${value}${PDI}`;
}

/**
 * HTTP status codes and similar machine codes are Latin digits, isolated LTR: `۲xx`, `۵۰۰` are not
 * what an engineer greps for. 500 -> «500», "2xx" -> «2xx».
 */
export function statusCode(code: number | string): string {
  return `${LRI}${code}${PDI}`;
}
