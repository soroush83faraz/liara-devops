// Pure canvas layout: network frames containing a grid of service nodes. React Flow positions child nodes
// relative to their frame, so saved positions are relative too.
import type { OverviewNetwork, OverviewService } from "./types";

export const NODE_WIDTH = 264;
/**
 * FIXED card footprint (the card renders at exactly this height): header, a status row that may wrap to two lines,
 * three detail rows and a RESERVED alert row, so an alert CTA appearing never grows the card into its neighbour.
 */
export const NODE_HEIGHT = 260;
/** Minimum free space between two cards (also where edges and their labels run). */
export const NODE_GAP = 44;
export const FRAME_PAD = 28;
export const FRAME_HEADER = 52;
export const FRAME_GAP = 56;
export const MAX_ROW_WIDTH = 1500;
export const NO_NETWORK_FRAME = "net:__none__";

export type SavedPositions = Record<string, { x: number; y: number }>;

export interface FrameLayout {
  /** Frame node id (`net:<networkId>`). */
  id: string;
  networkId: string | null;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeLayout {
  id: string;
  frameId: string;
  /** Relative to the frame. */
  x: number;
  y: number;
}

export interface GraphLayout {
  frames: FrameLayout[];
  nodes: NodeLayout[];
}

export const frameIdFor = (networkId: string | null): string => (networkId ? `net:${networkId}` : NO_NETWORK_FRAME);

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Grid slot of the i-th of `count` nodes. Columns grow with sqrt(count), capped at 3. */
export function gridSlot(index: number, count: number): { x: number; y: number } {
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(count))));
  return {
    x: FRAME_PAD + (index % cols) * (NODE_WIDTH + NODE_GAP),
    y: FRAME_HEADER + Math.floor(index / cols) * (NODE_HEIGHT + NODE_GAP),
  };
}

/**
 * Frames per network (the "no network" frame last, only when something is in it), nodes in a grid inside each
 * frame, frames packed left-to-right in rows. `saved` overrides node positions (frames grow to contain them).
 */
export function layoutGraph(
  services: readonly OverviewService[],
  networks: readonly OverviewNetwork[],
  saved: SavedPositions = {},
): GraphLayout {
  const knownIds = new Set(networks.map((n) => n.id));
  const groups = new Map<string | null, OverviewService[]>();
  for (const n of networks) groups.set(n.id, []);
  for (const s of services) {
    const key = s.networkId && knownIds.has(s.networkId) ? s.networkId : null;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const order: Array<string | null> = [...networks.map((n) => n.id)];
  if ((groups.get(null)?.length ?? 0) > 0) order.push(null);

  const frames: FrameLayout[] = [];
  const nodes: NodeLayout[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const networkId of order) {
    const members = (groups.get(networkId) ?? []).slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    const frameId = frameIdFor(networkId);
    let maxX = FRAME_PAD + NODE_WIDTH;
    let maxY = FRAME_HEADER + NODE_HEIGHT;
    const placed = separate(
      members.map((s, i) => {
        const slot = gridSlot(i, members.length);
        const p = saved[s.id];
        const pos = p && finite(p.x) && finite(p.y) ? { x: Math.max(FRAME_PAD / 2, p.x), y: Math.max(FRAME_HEADER, p.y) } : slot;
        return { id: s.id, x: pos.x, y: pos.y };
      }),
    );
    for (const pos of placed) {
      nodes.push({ id: pos.id, frameId, x: pos.x, y: pos.y });
      maxX = Math.max(maxX, pos.x + NODE_WIDTH);
      maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
    }
    const width = maxX + FRAME_PAD;
    const height = maxY + FRAME_PAD;
    if (cursorX > 0 && cursorX + width > MAX_ROW_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + FRAME_GAP;
      rowHeight = 0;
    }
    const net = networks.find((n) => n.id === networkId);
    frames.push({ id: frameId, networkId, name: net?.name ?? null, x: cursorX, y: cursorY, width, height });
    cursorX += width + FRAME_GAP;
    rowHeight = Math.max(rowHeight, height);
  }
  return { frames, nodes };
}

const overlapsWithGap = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  a.x < b.x + NODE_WIDTH + NODE_GAP && b.x < a.x + NODE_WIDTH + NODE_GAP && a.y < b.y + NODE_HEIGHT + NODE_GAP && b.y < a.y + NODE_HEIGHT + NODE_GAP;

/**
 * Keeps saved (dragged) positions but never lets two cards overlap or touch: a card that collides with one placed
 * before it (top-to-bottom, then left-to-right) moves straight down below it, keeping NODE_GAP. Deterministic.
 */
export function separate<T extends { x: number; y: number }>(items: readonly T[]): T[] {
  const order = items.map((it, i) => ({ it: { ...it }, i })).sort((a, b) => a.it.y - b.it.y || a.it.x - b.it.x || a.i - b.i);
  const done: T[] = [];
  for (const { it } of order) {
    for (let guard = 0; guard < items.length + 1; guard++) {
      const hit = done.find((d) => overlapsWithGap(d, it));
      if (!hit) break;
      it.y = hit.y + NODE_HEIGHT + NODE_GAP;
    }
    done.push(it);
  }
  // Return in input order.
  return order.sort((a, b) => a.i - b.i).map((o) => o.it);
}

export type HandleSide = "top" | "right" | "bottom" | "left";

/**
 * Which card sides an edge leaves and enters, from the cards' absolute top-left corners. Vertical neighbours connect
 * bottom->top (the edge runs through the gap between rows), horizontal ones side->side, so an edge never has to cross
 * a card's text to reach the opposite side.
 */
export function edgeSides(from: { x: number; y: number }, to: { x: number; y: number }): { source: HandleSide; target: HandleSide } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) >= NODE_HEIGHT / 2 && Math.abs(dy) / NODE_HEIGHT >= Math.abs(dx) / NODE_WIDTH) {
    return dy > 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
  }
  return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
}

/** Validates data read from localStorage; anything malformed is dropped. */
export function sanitizeSaved(raw: unknown): SavedPositions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: SavedPositions = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = v as { x?: unknown; y?: unknown } | null;
    if (p && finite(p.x) && finite(p.y) && Math.abs(p.x) < 20000 && Math.abs(p.y) < 20000) out[id] = { x: p.x, y: p.y };
  }
  return out;
}

export const layoutStorageKey = (accountId: string): string => `hamyar:layout:${accountId}`;

export function loadLayout(accountId: string): SavedPositions {
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(accountId));
    return raw ? sanitizeSaved(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveLayout(accountId: string, positions: SavedPositions): void {
  try {
    window.localStorage.setItem(layoutStorageKey(accountId), JSON.stringify(positions));
  } catch {
    // storage unavailable: the layout simply is not remembered
  }
}

export function clearLayout(accountId: string): void {
  try {
    window.localStorage.removeItem(layoutStorageKey(accountId));
  } catch {
    // ignore
  }
}
