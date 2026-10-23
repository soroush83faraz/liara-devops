"use client";

import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { ease } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

/** Accessible expander (button + region). Touch target >= 44px; the chevron rotates unless motion is reduced. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
  summaryClassName,
  onToggle,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  summaryClassName?: string;
  onToggle?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
          onToggle?.(!open);
        }}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-sm px-2 text-start text-sm font-medium transition-colors",
          "text-foreground hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          summaryClassName,
        )}
      >
        <span className="min-w-0">{summary}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
        />
      </button>
      <div id={id} hidden={!open} className="pt-1">
        {open ? (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: ease.out }}>
            {children}
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}
