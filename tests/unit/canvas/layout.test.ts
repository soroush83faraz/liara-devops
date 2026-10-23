// SYNTHETIC inputs.
import { describe, expect, it } from "vitest";
import {
  FRAME_HEADER,
  FRAME_PAD,
  MAX_ROW_WIDTH,
  NODE_HEIGHT,
  NODE_WIDTH,
  NO_NETWORK_FRAME,
  gridSlot,
  layoutGraph,
  layoutStorageKey,
  sanitizeSaved,
} from "@/lib/canvas/layout";
import type { OverviewService } from "@/lib/canvas/types";

const svc = (id: string, networkId: string | null, kind: "app" | "db" = "app"): OverviewService => ({
  id,
  kind,
  name: id,
  networkId,
  platformOrEngine: "node",
  status: "running",
});

describe("layoutGraph", () => {
  it("groups by network, puts the no-network frame last, and places nodes in a grid inside frames", () => {
    const g = layoutGraph([svc("a", "n1"), svc("b", "n1"), svc("c", null)], [{ id: "n1", name: "shop" }, { id: "n2", name: "empty" }]);
    expect(g.frames.map((f) => f.id)).toEqual(["net:n1", "net:n2", NO_NETWORK_FRAME]);
    expect(g.frames.find((f) => f.id === NO_NETWORK_FRAME)?.name).toBeNull();
    const a = g.nodes.find((n) => n.id === "a")!;
    const b = g.nodes.find((n) => n.id === "b")!;
    expect(a).toMatchObject({ frameId: "net:n1", x: FRAME_PAD, y: FRAME_HEADER });
    expect(b.x).toBeGreaterThan(a.x);
    const frame = g.frames[0];
    expect(frame.width).toBeGreaterThanOrEqual(b.x + NODE_WIDTH);
    expect(frame.height).toBeGreaterThanOrEqual(a.y + NODE_HEIGHT);
  });
  it("omits the no-network frame when empty and routes unknown network ids to it", () => {
    expect(layoutGraph([svc("a", "n1")], [{ id: "n1", name: "x" }]).frames.map((f) => f.id)).toEqual(["net:n1"]);
    const g = layoutGraph([svc("a", "ghost")], []);
    expect(g.frames.map((f) => f.id)).toEqual([NO_NETWORK_FRAME]);
  });
  it("wraps frames into rows and never overlaps them", () => {
    const nets = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, name: `n${i}` }));
    const services = nets.flatMap((n) => [svc(`${n.id}-a`, n.id), svc(`${n.id}-b`, n.id), svc(`${n.id}-c`, n.id)]);
    const { frames } = layoutGraph(services, nets);
    expect(Math.max(...frames.map((f) => f.y))).toBeGreaterThan(0);
    for (const f of frames) if (f.y === 0) expect(f.x + f.width).toBeLessThanOrEqual(MAX_ROW_WIDTH + 1);
    for (let i = 0; i < frames.length; i++)
      for (let j = i + 1; j < frames.length; j++) {
        const p = frames[i];
        const q = frames[j];
        const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
        expect(overlap).toBe(false);
      }
  });
  it("honours saved positions and grows the frame to contain them; ignores junk", () => {
    const g = layoutGraph([svc("a", "n1"), svc("b", "n1")], [{ id: "n1", name: "x" }], { a: { x: 700, y: 400 }, b: { x: Number.NaN, y: 1 } });
    expect(g.nodes.find((n) => n.id === "a")).toMatchObject({ x: 700, y: 400 });
    expect(g.nodes.find((n) => n.id === "b")).toMatchObject(gridSlot(1, 2));
    expect(g.frames[0].width).toBeGreaterThanOrEqual(700 + NODE_WIDTH);
  });
  it("is deterministic", () => {
    const args = [[svc("b", "n1"), svc("a", "n1")], [{ id: "n1", name: "x" }]] as const;
    expect(layoutGraph(...args)).toEqual(layoutGraph(...args));
  });
});

describe("saved layout", () => {
  it("sanitizes stored data", () => {
    expect(sanitizeSaved(null)).toEqual({});
    expect(sanitizeSaved([1])).toEqual({});
    expect(sanitizeSaved({ a: { x: 1, y: 2 }, b: { x: "1", y: 2 }, c: { x: 1e9, y: 0 }, d: null })).toEqual({ a: { x: 1, y: 2 } });
  });
  it("keys per account", () => {
    expect(layoutStorageKey("abc")).toBe("hamyar:layout:abc");
  });
});
