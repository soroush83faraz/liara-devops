import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

function block(startMarker: string): Record<string, string> {
  const start = css.indexOf(startMarker);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const tokens: Record<string, string> = {};
  for (const m of css.slice(open, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2];
  return tokens;
}

const light = block(":root {");
const dark = { ...light, ...block("@media (prefers-color-scheme: dark)") };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token] pairs that components actually combine.
const TEXT_PAIRS: Array<[string, string]> = [
  ["foreground", "background"],
  ["foreground", "surface"],
  ["foreground", "surface-muted"],
  ["muted", "background"],
  ["muted", "surface"],
  ["muted", "surface-muted"],
  ["accent", "background"],
  ["accent", "surface"],
  ["accent-foreground", "accent"],
  ["accent-ink", "accent-soft"],
  ["danger-foreground", "danger"],
  ["ok", "surface"],
  ["warn", "surface"],
  ["danger", "surface"],
  ["ok", "background"],
  ["warn", "background"],
  ["danger", "background"],
  ["ok-ink", "ok-soft"],
  ["warn-ink", "warn-soft"],
  ["danger-ink", "danger-soft"],
  ["code-fg", "code-bg"],
  ["background", "foreground"], // tooltip
];

// Status colours are also used as text on their own soft tint (badges). They must keep a margin over 4.5:1 so
// anti-aliasing and small text stay readable: >= 4.8:1.
const MARGIN_PAIRS: Array<[string, string]> = [
  ["ok", "ok-soft"],
  ["warn", "warn-soft"],
  ["danger", "danger-soft"],
  ["accent", "accent-soft"],
  ["ok", "surface"],
  ["warn", "surface"],
  ["ok", "background"],
  ["warn", "background"],
];
const MARGIN = 4.8;

describe.each([
  ["light", light],
  ["dark", dark],
])("%s tokens", (_name, tokens) => {
  it.each(TEXT_PAIRS)("%s on %s has contrast >= 4.5:1", (fg, bg) => {
    expect(tokens[fg], `missing token ${fg}`).toBeDefined();
    expect(tokens[bg], `missing token ${bg}`).toBeDefined();
    expect(ratio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARGIN_PAIRS)("%s on %s keeps a margin (>= 4.8:1)", (fg, bg) => {
    expect(ratio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(MARGIN);
  });

  it("form-field borders and switch track have >= 3:1 against the surface", () => {
    expect(ratio(tokens["border-strong"], tokens.surface)).toBeGreaterThanOrEqual(3);
  });
});
