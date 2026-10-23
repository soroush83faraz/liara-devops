"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { DIR } from "./dir";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root dir={DIR} className={cn("flex flex-col", className)} {...props} />;
}

/**
 * The tab strip scrolls sideways when the tabs do not fit (narrow panels, phones): tabs never shrink or clip, the
 * scroll snaps to tab edges, a gradient on each edge hints that more tabs are hidden, and the selected tab is
 * scrolled into view (also when it changes from outside, e.g. a deep link). Scroll offsets are direction-agnostic.
 */
export function TabsList({ className, children, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // scrollLeft is 0 at the reading-start edge and grows (LTR) or shrinks (RTL) from there: use the magnitude.
    const offset = Math.abs(el.scrollLeft);
    const max = el.scrollWidth - el.clientWidth;
    setEdges((prev) => {
      const next = { start: offset > 1, end: offset < max - 1 };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  }, []);

  const revealActive = useCallback(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!el || !active) return;
    const list = el.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    const pad = 28; // keep the edge fade from covering the selected tab
    if (tab.left < list.left + pad) el.scrollBy({ left: tab.left - list.left - pad });
    else if (tab.right > list.right - pad) el.scrollBy({ left: tab.right - list.right + pad });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    revealActive();
    measure();
    const mutations = new MutationObserver(() => {
      revealActive();
      measure();
    });
    mutations.observe(el, { attributes: true, attributeFilter: ["data-state"], subtree: true, childList: true });
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [measure, revealActive]);

  return (
    <div data-tabs-bar className="relative min-w-0">
      <TabsPrimitive.List
        ref={ref}
        onScroll={measure}
        className={cn(
          "flex snap-x snap-proximity gap-1 overflow-x-auto overscroll-x-contain border-b border-border [scrollbar-width:thin]",
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
      <span
        aria-hidden
        data-edge="start"
        className={cn(
          "pointer-events-none absolute inset-y-0 start-0 w-8 bg-linear-to-r from-surface to-transparent transition-opacity rtl:bg-linear-to-l",
          edges.start ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        data-edge="end"
        className={cn(
          "pointer-events-none absolute inset-y-0 end-0 w-8 bg-linear-to-l from-surface to-transparent transition-opacity rtl:bg-linear-to-r",
          edges.end ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative inline-flex min-h-11 min-w-fit shrink-0 snap-start items-center gap-2 whitespace-nowrap px-3 text-[15px] text-muted transition-colors",
        "hover:text-foreground data-[state=active]:font-semibold data-[state=active]:text-accent",
        "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", className)}
      {...props}
    />
  );
}
