"use client";

import { motion } from "motion/react";
import { METRIC_RANGES } from "@/lib/service/app-read/metrics-range";
import type { MetricRange } from "@/lib/service/app-read/types";
import { fa } from "@/lib/i18n/fa";
import { spring } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

/**
 * Segmented control for the time window. Plain buttons (aria-pressed): Tab/Enter/Space work, no custom key handling.
 * The selected pill glides to the new segment (shared layout), so the change of window is visible, not just announced.
 */
export function RangePicker({ value, onChange }: { value: MetricRange; onChange: (r: MetricRange) => void }) {
  return (
    <div role="group" aria-label={fa.observability.controls.range} className="inline-flex rounded-sm border border-border bg-surface-muted/70 p-0.5">
      {METRIC_RANGES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(r)}
            className={cn(
              "relative min-h-11 rounded-[6px] px-3.5 text-sm transition-colors md:min-h-8",
              "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent",
              active ? "font-semibold text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="obs-range-indicator"
                transition={spring.pop}
                aria-hidden
                className="absolute inset-0 rounded-[6px] border border-border bg-surface shadow-[var(--shadow-soft)]"
              />
            ) : null}
            <span className="relative">{fa.appOps.metrics.ranges[r]}</span>
          </button>
        );
      })}
    </div>
  );
}
