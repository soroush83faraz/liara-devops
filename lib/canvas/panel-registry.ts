// Registry the service units fill: `registerPanel("app", "logs", LogsTab)` from a module that the page imports
// (see components/canvas/panel-registrations.ts). The panel slot renders whatever is registered.
import type { ComponentType } from "react";
import type { ServiceKind } from "./types";

export interface PanelProps {
  /** Panel id as used in `?service=` (app name, or `db:<hostname>`). */
  serviceId: string;
  /** Resource name without the id prefix: app name, or database hostname. */
  name: string;
  kind: ServiceKind;
  tab: string;
}

export interface PanelMeta {
  /** Persian label for the tab strip. Defaults to the tab id. */
  label?: string;
  /** Lower first. Defaults to registration order. */
  order?: number;
}

interface Entry {
  Component: ComponentType<PanelProps>;
  meta: PanelMeta;
  seq: number;
}

const key = (kind: ServiceKind, tab: string) => `${kind}:${tab}`;

// Shared via globalThis so HMR / duplicate module instances do not lose registrations.
const REGISTRY_SYMBOL = Symbol.for("hamyar.panelRegistry");
function store(): Map<string, Entry> {
  const g = globalThis as unknown as Record<symbol, Map<string, Entry> | undefined>;
  return (g[REGISTRY_SYMBOL] ??= new Map());
}

export function registerPanel(kind: ServiceKind, tab: string, Component: ComponentType<PanelProps>, meta: PanelMeta = {}): void {
  const reg = store();
  const prev = reg.get(key(kind, tab));
  reg.set(key(kind, tab), { Component, meta, seq: prev?.seq ?? reg.size });
}

export function getPanel(kind: ServiceKind, tab: string): ComponentType<PanelProps> | undefined {
  return store().get(key(kind, tab))?.Component;
}

/** Registered tabs for a kind, in display order. */
export function listPanelTabs(kind: ServiceKind): Array<{ tab: string; label: string }> {
  return [...store().entries()]
    .filter(([k]) => k.startsWith(`${kind}:`))
    .map(([k, e]) => ({ tab: k.slice(kind.length + 1), label: e.meta.label ?? k.slice(kind.length + 1), order: e.meta.order ?? e.seq }))
    .sort((a, b) => a.order - b.order)
    .map(({ tab, label }) => ({ tab, label }));
}
