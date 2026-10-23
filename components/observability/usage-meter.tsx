"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  accent: { fill: "bg-accent", track: "bg-accent-soft" },
  warn: { fill: "bg-warn", track: "bg-warn-soft" },
  danger: { fill: "bg-danger", track: "bg-danger-soft" },
} as const;

/**
 * Value against the plan limit: a bar plus the percentage in text (the colour only reinforces it).
 * The fill carries severity (accent -> warn -> danger) over a lighter track of the same hue, and slides in from the
 * reading start (a transform, so the rounded leading edge never distorts).
 */
export function UsageMeter({ ratio, label, valueText, caption }: { ratio: number; label: string; valueText: string; caption: string }) {
  const pct = Math.round(ratio * 100);
  const shown = Math.max(pct, ratio > 0 ? 2 : 0);
  const tone = TONES[ratio >= 0.9 ? "danger" : ratio >= 0.7 ? "warn" : "accent"];
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const offset = `${100 - (mounted ? shown : 0)}%`;
  return (
    <div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={valueText}
        className={cn("relative h-1.5 w-full overflow-hidden rounded-full", tone.track)}
      >
        <div
          className={cn(
            "absolute inset-0 rounded-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
            "[transform:translateX(calc(-1*var(--off)))] rtl:[transform:translateX(var(--off))]",
            tone.fill,
          )}
          style={{ ["--off" as string]: offset }}
        />
      </div>
      <p className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-xs text-muted">
        <span className="font-medium text-foreground/90">{valueText}</span>
        <span>{caption}</span>
      </p>
    </div>
  );
}
