// Pure matching logic of the global command bar (⌘/Ctrl+K): pick a service, or type a question.
import type { OverviewService } from "@/lib/canvas/types";

export interface CommandItem {
  service: Pick<OverviewService, "id" | "kind" | "name">;
  /** `open`: just show that service's copilot. `ask`: also send `question` there. */
  mode: "open" | "ask";
  question?: string;
}

const byName = (a: CommandItem, b: CommandItem) => a.service.name.localeCompare(b.service.name);

/**
 * - empty query: every service (open);
 * - a single word that matches service names: those services (open);
 * - anything with whitespace, or a word matching no service: a question, offered for every service (ask).
 */
export function buildCommandItems(services: readonly OverviewService[], query: string): CommandItem[] {
  const q = query.trim();
  const base = services.map((service) => ({ id: service.id, kind: service.kind, name: service.name }));
  if (q === "") return base.map((service): CommandItem => ({ service, mode: "open" })).sort(byName);
  const lower = q.toLowerCase();
  if (!/\s/.test(q)) {
    const matches = base.filter((s) => s.name.toLowerCase().includes(lower));
    if (matches.length > 0) {
      // exact/prefix matches first
      return matches
        .map((service): CommandItem => ({ service, mode: "open" }))
        .sort((a, b) => rank(a.service.name, lower) - rank(b.service.name, lower) || byName(a, b));
    }
  }
  return base.map((service): CommandItem => ({ service, mode: "ask", question: q })).sort(byName);
}

function rank(name: string, q: string): number {
  const n = name.toLowerCase();
  return n === q ? 0 : n.startsWith(q) ? 1 : 2;
}

/** Cmd+K on macOS, Ctrl+K elsewhere. */
export function isCommandShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey?: boolean; shiftKey?: boolean }): boolean {
  return e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}
