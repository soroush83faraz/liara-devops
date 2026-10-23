import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <dt className="flex items-center gap-1.5 text-sm text-muted">
        {icon ? <span aria-hidden className="text-muted [&>svg]:size-4">{icon}</span> : null}
        {label}
      </dt>
      <dd className="text-xl font-semibold leading-9 tabular-nums">{value}</dd>
      {hint ? <dd className="text-xs leading-6 text-muted">{hint}</dd> : null}
    </div>
  );
}

/** Group of Stats laid out in a responsive grid (renders a <dl>). */
export function StatGroup({ className, children }: { className?: string; children: ReactNode }) {
  return <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4", className)}>{children}</dl>;
}
