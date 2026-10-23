// Pure matching logic of the global command bar (⌘/Ctrl+K): pick a service, or type a question.
import type { OverviewService } from "@/lib/canvas/types";

export interface CommandItem {
  service: Pick<OverviewService, "id" | "kind" | "name">;
  /** `open`: just show that service's copilot. `ask`: also send `question` there. */
  mode: "open" | "ask";
  question?: string;
  /** Ask mode: the question names this service, so the palette may pre-select it. */
  related?: boolean;
}

const byName = (a: CommandItem, b: CommandItem) => a.service.name.localeCompare(b.service.name);

/**
 * - empty query: every service (open);
 * - a single word that matches service names: those services (open);
 * - anything with whitespace, or a word matching no service: a question, offered for every service (ask); services
 *   the question names come first and are flagged `related` (nothing else is, so no unrelated one gets pre-selected).
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
  // Whole-name match: «shop» is not named by «shop-db» (service names are [a-z0-9-]).
  const edge = (c: string | undefined) => c === undefined || !/[a-z0-9-]/.test(c);
  const mentioned = (name: string) => {
    const n = name.toLowerCase();
    for (let at = lower.indexOf(n); at >= 0; at = lower.indexOf(n, at + 1)) {
      if (edge(lower[at - 1]) && edge(lower[at + n.length])) return true;
    }
    return false;
  };
  return base
    .map((service): CommandItem => ({ service, mode: "ask", question: q, ...(mentioned(service.name) ? { related: true } : {}) }))
    .sort((a, b) => Number(!!b.related) - Number(!!a.related) || byName(a, b));
}

function rank(name: string, q: string): number {
  const n = name.toLowerCase();
  return n === q ? 0 : n.startsWith(q) ? 1 : 2;
}

/** Cmd+K on macOS, Ctrl+K elsewhere. */
export function isCommandShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey?: boolean; shiftKey?: boolean }): boolean {
  return e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}
