import { cn } from "@/lib/utils";

/** Value against the plan limit: a bar plus the percentage in text (the colour only reinforces it). */
export function UsageMeter({ ratio, label, valueText, caption }: { ratio: number; label: string; valueText: string; caption: string }) {
  const pct = Math.round(ratio * 100);
  const tone = ratio >= 0.9 ? "bg-danger" : ratio >= 0.7 ? "bg-warn" : "bg-ok";
  return (
    <div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={valueText}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(pct, ratio > 0 ? 2 : 0)}%` }} />
      </div>
      <p className="mt-1 flex flex-wrap justify-between gap-x-2 text-xs text-muted">
        <span>{valueText}</span>
        <span>{caption}</span>
      </p>
    </div>
  );
}
