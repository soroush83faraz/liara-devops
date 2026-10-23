"use client";

import { Activity, Gauge, History, ServerCrash, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { fa } from "@/lib/i18n/fa";
import { fadeUp, stagger } from "@/lib/ui/motion";

const p = fa.copilotUi.panel;

export const SUGGESTIONS = [p.chips.error500, p.chips.slow, p.chips.status, p.chips.lastRelease] as const;
const ICONS: readonly LucideIcon[] = [ServerCrash, Gauge, Activity, History];

/** Quick questions for an empty thread. Touch targets are >= 44px. */
export function SuggestedChips({ onPick, disabled }: { onPick: (text: string) => void; disabled?: boolean }) {
  return (
    <motion.ul initial="hidden" animate="show" variants={stagger(0.05, 0.1)} aria-label={p.chipsLabel} className="grid gap-2 sm:grid-cols-2">
      {SUGGESTIONS.map((s, i) => {
        const Icon = ICONS[i] ?? Activity;
        return (
          <motion.li key={s} variants={fadeUp}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              className="group flex min-h-11 w-full items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-start text-sm transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px hover:border-accent/45 hover:bg-accent-soft/60 active:translate-y-0 disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-surface-muted text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent-ink">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">{s}</span>
            </button>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
