// Guard: the dev-only copilot mock must not reach a production bundle. When a production build exists
// (`.next/static` + `.next/BUILD_ID`), every file in it is searched for the mock's markers; the first run of
// `npm run build && npx vitest run tests/unit/quality/no-mock-in-bundle.test.ts` proves a given build is clean.
// Without a build the bundle test is skipped (plain `vitest run` stays hermetic); the scanner itself is always
// self-tested against a temp directory, so "it can fail" is proven on every run.
// BUNDLE_GUARD_DIR=<dir> points the scan at another directory (used to demo a failing bundle outside the repo).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { devMock } from "../../../lib/i18n/dev-mock";
import { fa } from "../../../lib/i18n/fa";
import { mockStreamCopy } from "../../../lib/i18n/mock-stream-copy";
import { ROOT } from "./scan";

/** Identifiers and storage keys of the mock (code-level markers). */
const CODE_MARKERS = ["hl.copilotScenario", "hl.copilotMock", "mock-controls", "NEXT_PUBLIC_COPILOT_MOCK", "inc_mock_", "mockFetch", "mock-stream", "devMock", "mockStreamCopy"];
/** Copy that must exist only in the dev mock (the fixed labels from the brief + everything in dev-mock.ts). */
const COPY_MARKERS = ["داده‌ی نمونه", "داده‌ی ساختگی", "سناریوی آزمایشی"];

const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
// Long strings only: short mock words («کهنه», «حذف|پاک|delete») also occur in real UI copy.
// Strings that also exist in the production dictionary (e.g. «بررسی مستقیم سایت») are real UI copy, not markers.
const prodDictionary = JSON.stringify(fa);
const longCopy = (v: unknown) => strings(v).filter((s) => s.length >= 14 && !prodDictionary.includes(s));

export const MARKERS: readonly string[] = [...new Set([...CODE_MARKERS, ...COPY_MARKERS, ...strings(devMock).filter((s) => s.length >= 8 && !prodDictionary.includes(s)), ...longCopy(mockStreamCopy)])];

const TEXT_EXT = /\.(js|mjs|cjs|css|json|html|txt|map|rsc)$/i;

/** A marker as it can appear in emitted JS: raw UTF-8, or with non-ASCII characters as \uXXXX escapes. */
function variants(marker: string): Buffer[] {
  const escaped = [...marker].map((c) => (c.charCodeAt(0) > 126 ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}` : c)).join("");
  return [...new Set([marker, escaped])].map((s) => Buffer.from(s, "utf8"));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** `file: marker` for every dev-only marker found under `dir`. */
export function findMarkers(dir: string, markers: readonly string[] = MARKERS): string[] {
  const vs = markers.map((m) => [m, variants(m)] as const);
  const hits: string[] = [];
  for (const file of walk(dir)) {
    const buf = readFileSync(file);
    for (const [m, bufs] of vs) if (bufs.some((b) => buf.includes(b))) hits.push(`${file}: ${m}`);
  }
  return hits;
}

describe("marker scanner (hermetic self-test)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "bundle-guard-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("covers the required markers", () => {
    for (const m of ["hl.copilotScenario", "mock-controls", "NEXT_PUBLIC_COPILOT_MOCK", "inc_mock_", "mockFetch", ...COPY_MARKERS]) expect(MARKERS).toContain(m);
    expect(MARKERS).toContain(devMock.dataBadge);
    expect(MARKERS).toContain(devMock.mockNote);
  });

  it("fails (names the file) on a bundle containing a marker, raw or \\u-escaped, and passes on a clean one", () => {
    const clean = join(tmp, "clean");
    const dirty = join(tmp, "dirty", "chunks");
    mkdirSync(clean, { recursive: true });
    mkdirSync(dirty, { recursive: true });
    writeFileSync(join(clean, "a.js"), 'console.log("hello", "حالت آزمایشی")');
    writeFileSync(join(dirty, "b.js"), 'sessionStorage.getItem("hl.copilotScenario")');
    writeFileSync(join(dirty, "c.js"), `x="${"داده‌ی ساختگی".replace(/[^\x00-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`);
    expect(findMarkers(clean)).toEqual([]);
    const hits = findMarkers(join(tmp, "dirty"));
    expect(hits.some((h) => h.endsWith("b.js: hl.copilotScenario"))).toBe(true);
    expect(hits.some((h) => h.endsWith("c.js: داده‌ی ساختگی"))).toBe(true);
  });
});

const dir = process.env.BUNDLE_GUARD_DIR ?? join(ROOT, ".next", "static");
const isProdBuild = process.env.BUNDLE_GUARD_DIR ? existsSync(dir) : existsSync(dir) && existsSync(join(ROOT, ".next", "BUILD_ID"));

describe.skipIf(!isProdBuild)(isProdBuild ? "production bundle contains no dev-only mock" : "production bundle contains no dev-only mock (SKIPPED: no production build at .next/static + .next/BUILD_ID; run `npm run build`)", () => {
  it("no dev-only marker in any file", () => {
    expect(findMarkers(dir), `dev-only mock leaked into ${dir} (file: marker)`).toEqual([]);
  });
});
