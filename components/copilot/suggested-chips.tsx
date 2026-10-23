"use client";

import { fa } from "@/lib/i18n/fa";

const p = fa.copilotUi.panel;

export const SUGGESTIONS = [p.chips.error500, p.chips.slow, p.chips.status, p.chips.lastRelease] as const;

/** Quick questions for an empty thread. Touch targets are >= 44px. */
export function SuggestedChips({ onPick, disabled }: { onPick: (text: string) => void; disabled?: boolean }) {
  return (
    <ul aria-label={p.chipsLabel} className="flex flex-wrap gap-2">
      {SUGGESTIONS.map((s) => (
        <li key={s}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="min-h-11 rounded-full border border-border-strong/50 bg-surface px-4 text-sm hover:bg-accent-soft hover:text-accent-ink disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {s}
          </button>
        </li>
      ))}
    </ul>
  );
}
