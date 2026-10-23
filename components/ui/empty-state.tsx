import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Empty list/screen with the next step as an action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      {icon ? (
        <span aria-hidden className="flex size-12 items-center justify-center rounded-md border border-border bg-surface-muted text-accent [&>svg]:size-6">
          {icon}
        </span>
      ) : null}
      <h3 className="text-base font-bold leading-snug">{title}</h3>
      {description ? <p className="max-w-md text-sm leading-6 text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
