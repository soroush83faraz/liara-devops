// Guard: all user-facing Persian text lives in the dictionary (lib/i18n) so tone, glossary and digits stay consistent.
// Only Persian LETTERS count (punctuation such as «،» and «؛» used as separators is fine). Comments are ignored.
import { describe, expect, it } from "vitest";
import { listFiles, read, stripComments } from "./scan";

const PERSIAN_LETTER = /[ء-غف-يٱ-ۓە]/;

/** Folders/files that are the dictionary itself. */
const DICTIONARY_PREFIXES = ["lib/i18n/"];
const DICTIONARY_FILES = new Set(["lib/agent/prompts.fa.ts", "lib/agent/fa-messages.ts", "lib/evidence/fa-templates.ts"]);

/** Explicit exceptions (file -> reason). Each is data, a fixture or a dev-only page, not product copy. */
const EXCEPTIONS: Record<string, string> = {
  "lib/security/injection.ts": "Persian prompt-injection DETECTION patterns (language data matched against logs), not UI copy",
  "lib/evidence/injection.ts": "Persian prompt-injection detection patterns (language data), not UI copy",
  "lib/agent/claims-filter.ts": "Persian certainty/action DETECTION patterns matched against model prose (language data), not UI copy",
  "lib/setup/env-names.ts": "README heading words (متغیر, پیکربندی) inside a detection regex: language data, not UI copy",
  "lib/contracts/fixtures.ts": "synthetic fixture objects used by the dev-only mock stream and tests",
  "app/%5Fkit/kit.tsx": "dev-only component gallery (/_kit) with sample Persian content; not reachable in the product flow",
};

function offendersIn(file: string): string | null {
  const lines = stripComments(read(file))
    .split("\n")
    .map((text, i) => ({ n: i + 1, text }))
    .filter(({ text }) => PERSIAN_LETTER.test(text));
  if (lines.length === 0) return null;
  const first = lines[0];
  return `${file}: ${lines.length} line(s), first at L${first.n}: ${first.text.trim().slice(0, 70)}`;
}

describe("Persian text only in the dictionary", () => {
  it("the detector sees Persian letters but not Persian punctuation", () => {
    expect(PERSIAN_LETTER.test("سلام")).toBe(true);
    expect(PERSIAN_LETTER.test('join("، ")')).toBe(false);
    expect(PERSIAN_LETTER.test('join("؛ ")')).toBe(false);
    expect(PERSIAN_LETTER.test("hello 123 ۱۲۳")).toBe(false);
  });

  it("no Persian letters in code outside lib/i18n, the allowed .fa files and the listed exceptions", () => {
    const files = listFiles(["app", "components", "lib"], [".ts", ".tsx"]).filter(
      (f) => !DICTIONARY_PREFIXES.some((p) => f.startsWith(p)) && !DICTIONARY_FILES.has(f) && !(f in EXCEPTIONS),
    );
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.map(offendersIn).filter((x): x is string => x !== null);
    expect(offenders, "Move these strings into lib/i18n (fa.ts or ns/*.ts) and use t()/fa.*. Offending files:").toEqual([]);
  });

  it("every exception still exists and still contains Persian letters", () => {
    const stale = Object.keys(EXCEPTIONS).filter((f) => {
      try {
        return offendersIn(f) === null;
      } catch {
        return true;
      }
    });
    expect(stale, "Delete exceptions that are no longer needed:").toEqual([]);
  });
});
