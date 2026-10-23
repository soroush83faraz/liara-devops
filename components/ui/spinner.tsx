import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({
  className,
  label,
}: {
  className?: string;
  /** Accessible label. Omit when the surrounding control already announces the loading state. */
  label?: string;
}) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex">
      <LoaderCircle aria-hidden className={cn("size-4 animate-spin", className)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
