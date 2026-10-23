import { cn } from "@/lib/utils";

/** Brand mark: three connected nodes (the project canvas), drawn inline so there is no asset to load. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <g className="stroke-accent-foreground" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M10 21 16 11 22 21" />
        <path d="M10 21h12" />
      </g>
      <g className="fill-accent-foreground">
        <circle cx="16" cy="10.5" r="2.6" />
        <circle cx="9.8" cy="21" r="2.6" />
        <circle cx="22.2" cy="21" r="2.6" />
      </g>
    </svg>
  );
}
