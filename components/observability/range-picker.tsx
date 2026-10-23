"use client";

import { METRIC_RANGES } from "@/lib/service/app-read/metrics-range";
import type { MetricRange } from "@/lib/service/app-read/types";
import { fa } from "@/lib/i18n/fa";
import { cn } from "@/lib/utils";

/** Segmented control for the time window. Plain buttons (aria-pressed): Tab/Enter/Space work, no custom key handling. */
export function RangePicker({ value, onChange }: { value: MetricRange; onChange: (r: MetricRange) => void }) {
  return (
    <div role="group" aria-label={fa.observability.controls.range} className="inline-flex overflow-hidden rounded-lg border border-border-strong/50 bg-surface">
      {METRIC_RANGES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(r)}
            className={cn(
              "min-h-11 border-s border-border px-3.5 text-sm transition-colors first:border-s-0 md:min-h-9",
              "focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
              active ? "bg-accent-soft font-semibold text-accent-ink" : "text-foreground hover:bg-surface-muted",
            )}
          >
            {fa.appOps.metrics.ranges[r]}
          </button>
        );
      })}
    </div>
  );
}
