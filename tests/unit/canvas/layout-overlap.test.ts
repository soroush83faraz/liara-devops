// Regression tests for canvas layout defects (C2, C5). SYNTHETIC inputs.
// Before the fix: cards grew when the alert CTA appeared and covered their neighbour (broken-shop's red button under
// shop-db), saved drag positions could stack cards, the env->DB edge left the right side of an app and cut back
// through the card text to the DB's left side, its label was muted text, and dark mode used React Flow's black.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NODE_GAP, NODE_HEIGHT, NODE_WIDTH, edgeSides, layoutGraph, separate } from "@/lib/canvas/layout";
import type { OverviewService } from "@/lib/canvas/types";

const svc = (id: string, kind: "app" | "db" = "app"): OverviewService => ({ id, kind, name: id, networkId: "n1", platformOrEngine: "node", status: "running" });
const gapBetween = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  !(a.x < b.x + NODE_WIDTH + NODE_GAP && b.x < a.x + NODE_WIDTH + NODE_GAP && a.y < b.y + NODE_HEIGHT + NODE_GAP && b.y < a.y + NODE_HEIGHT + NODE_GAP);

describe("C2: cards never overlap", () => {
  it("grid layout keeps NODE_GAP between every pair", () => {
    const { nodes } = layoutGraph(["a", "b", "c", "d", "e"].map((id) => svc(id)), [{ id: "n1", name: "main" }]);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(gapBetween(nodes[i], nodes[j])).toBe(true);
  });

  it("saved positions that collide (old smaller cards / a drop on top of another) are pushed apart; free ones are kept", () => {
    const saved = { a: { x: 40, y: 60 }, b: { x: 60, y: 120 }, c: { x: 900, y: 60 } };
    const { nodes } = layoutGraph([svc("a"), svc("b"), svc("c")], [{ id: "n1", name: "main" }], saved);
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    expect(at("a")).toMatchObject({ x: 40, y: 60 });
    expect(at("c")).toMatchObject({ x: 900, y: 60 });
    expect(at("b").x).toBe(60);
    expect(at("b").y).toBeGreaterThanOrEqual(60 + NODE_HEIGHT + NODE_GAP);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(gapBetween(nodes[i], nodes[j])).toBe(true);
  });

  it("separate() is stable and returns items in input order", () => {
    const out = separate([
      { id: "x", x: 0, y: 0 },
      { id: "y", x: 0, y: 0 },
      { id: "z", x: 0, y: 0 },
    ]);
    expect(out.map((o) => o.id)).toEqual(["x", "y", "z"]);
    expect(out.map((o) => o.y)).toEqual([0, NODE_HEIGHT + NODE_GAP, 2 * (NODE_HEIGHT + NODE_GAP)]);
  });

  it("the card has a FIXED height with the alert row reserved (no growth when the CTA appears)", () => {
    const src = readFileSync(new URL("../../../components/canvas/service-node.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/style=\{\{ width: NODE_WIDTH, height: NODE_HEIGHT \}\}/);
    expect(src).toContain("reserveAlertRow");
    expect(src).not.toMatch(/minHeight: NODE_HEIGHT/);
  });
});

describe("C2: edges leave through the facing sides", () => {
  it("vertical neighbours connect bottom->top (through the gap), horizontal ones side->side", () => {
    const row = NODE_HEIGHT + NODE_GAP;
    const col = NODE_WIDTH + NODE_GAP;
    expect(edgeSides({ x: 0, y: 0 }, { x: 0, y: row })).toEqual({ source: "bottom", target: "top" });
    expect(edgeSides({ x: 0, y: row }, { x: 0, y: 0 })).toEqual({ source: "top", target: "bottom" });
    expect(edgeSides({ x: 0, y: 0 }, { x: col, y: 0 })).toEqual({ source: "right", target: "left" });
    expect(edgeSides({ x: col, y: 0 }, { x: 0, y: 0 })).toEqual({ source: "left", target: "right" });
    // the screenshot case: app above-right of its DB -> leaves from the bottom, never across its own text
    expect(edgeSides({ x: col, y: 0 }, { x: col, y: row }).source).toBe("bottom");
  });
});

describe("C2/C5: readable edge label and themed canvas", () => {
  const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
  const token = (block: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  it("the edge label is a solid surface pill with foreground text (>= 4.5:1 in light and dark)", () => {
    const src = readFileSync(new URL("../../../components/canvas/env-edge.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/EDGE_LABEL_CLASS =[\s\S]*bg-surface[\s\S]*text-foreground/);
    expect(src).not.toMatch(/text-muted/);
    const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
    for (const block of [css, dark]) {
      expect(ratio(token(block, "foreground")!, token(block, "surface")!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("React Flow's background/minimap/controls use the theme tokens (navy in dark mode), not its neutral palette", () => {
    const src = readFileSync(new URL("../../../components/canvas/flow-canvas.tsx", import.meta.url), "utf8");
    expect(src).toContain('"--xy-background-color": "var(--background)"');
    expect(src).toContain('"--xy-minimap-background-color": "var(--surface)"');
    expect(src).toContain("style={FLOW_THEME}");
    expect(src).not.toMatch(/#2b7a99|#94a3b8/);
    const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
    expect(token(dark, "background")).toBe("#07090d");
  });
});
