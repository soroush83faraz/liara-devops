// Guard: the UI is RTL-first, so Tailwind classes must be logical (ms-/me-/ps-/pe-/start-/end-/text-start...),
// never physical (ml-/mr-/pl-/pr-/left-/right-/text-left/...). A physical class silently breaks in RTL.
import { describe, expect, it } from "vitest";
import { findAll, listFiles, read, stripComments } from "./scan";

const PHYSICAL = /(?<![\w])(?:-?(?:ml|mr|pl|pr)-(?:\d|\[|px|auto)|(?:left|right)-(?:\d|\[|px|full|1\/2|auto)|text-(?:left|right)\b|border-(?:l|r)(?:-|\b)|rounded-(?:l|r)(?:-|\b)|float-(?:left|right)\b|clear-(?:left|right)\b|scroll-(?:ml|mr|pl|pr)-)/g;

/**
 * Files where physical coordinates are legitimate (path -> reason). Currently empty: React Flow's Position.Left/Right
 * are enum values, not classes, so the canvas needed no exemption. Add an entry (with a reason) only if one does.
 */
const ALLOWLIST: Record<string, string> = {};

describe("logical (RTL-safe) Tailwind utilities", () => {
  it("the detector flags physical classes and accepts logical ones", () => {
    const bad = ["ml-2", "mr-4", "pl-3", "pr-px", "text-left", "text-right", "left-0", "md:right-4", "-ml-2", "border-l", "border-r-2", "rounded-l-lg", "rounded-r", "float-left"];
    for (const c of bad) expect([...`class="${c}"`.matchAll(PHYSICAL)].length, c).toBeGreaterThan(0);
    const good = ["ms-2", "me-4", "ps-3", "pe-px", "text-start", "text-end", "start-0", "end-4", "border-s", "border-e-2", "rounded-s-lg", "rounded-e", "ltr:ml-0", "right-to-left"];
    for (const c of good.filter((c) => !c.startsWith("ltr:"))) expect([...`class="${c}"`.matchAll(PHYSICAL)].length, c).toBe(0);
  });

  it("no physical-direction utilities outside the allowlist", () => {
    const files = listFiles(["app", "components", "lib"], [".ts", ".tsx", ".css"]);
    expect(files.length).toBeGreaterThan(100);
    const hits = files
      .filter((f) => !(f in ALLOWLIST))
      .flatMap((f) => findAll(f, f.endsWith(".css") ? read(f).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) : stripComments(read(f)), PHYSICAL));
    expect(hits, "Use logical utilities (ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e). Offenders:").toEqual([]);
  });
});
