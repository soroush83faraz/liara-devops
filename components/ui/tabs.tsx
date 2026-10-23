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
 * The selected tab's underline slides from the previous tab to the new one.
 */
export function TabsList({
  className,
  children,
  indicator: indicatorMode = "slide",
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & {
  /** "none": the caller draws its own underline inside the selected trigger (e.g. a shared-layout motion span). */
  indicator?: "slide" | "none";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  // Sliding underline under the selected tab (physical offsets inside the scrolling list).
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);

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

  const placeIndicator = useCallback(() => {
    const active = ref.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    setIndicator((prev) => {
      if (!active) return null;
      const next = { x: active.offsetLeft, w: active.offsetWidth };
      return prev && prev.x === next.x && prev.w === next.w ? prev : next;
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
    placeIndicator();
    const mutations = new MutationObserver(() => {
      revealActive();
      measure();
      placeIndicator();
    });
    mutations.observe(el, { attributes: true, attributeFilter: ["data-state"], subtree: true, childList: true });
    const resize = new ResizeObserver(() => {
      measure();
      placeIndicator();
    });
    resize.observe(el);
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [measure, revealActive, placeIndicator]);

  return (
    <div data-tabs-bar className="relative min-w-0">
      <TabsPrimitive.List
        ref={ref}
        onScroll={measure}
        data-indicator={indicator || indicatorMode === "none" ? "ready" : undefined}
        className={cn(
          // scroll-padding = the edge-fade width: snapping never parks a tab under a fade (without it the first tab
          // snaps past the list's own padding and starts out clipped behind the start fade).
          "group/tabs relative flex snap-x snap-proximity scroll-px-8 gap-1 overflow-x-auto overscroll-x-contain border-b border-border [scrollbar-width:none]",
          className,
        )}
        {...props}
      >
        {children}
        {indicator && indicatorMode === "slide" ? (
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-accent transition-[transform,width] duration-300 ease-out-expo"
            // Physical `left: 0`: offsetLeft is a physical coordinate in both directions.
            style={{ left: 0, width: Math.max(0, indicator.w - 16), transform: `translateX(${indicator.x + 8}px)` }}
          />
        ) : null}
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
        "relative inline-flex min-h-11 min-w-fit shrink-0 snap-start items-center gap-2 whitespace-nowrap px-3 text-sm font-medium text-muted transition-colors duration-150",
        "hover:text-foreground data-[state=active]:font-semibold data-[state=active]:text-foreground [&>svg]:size-4",
        // Until the sliding indicator is measured (first paint, before hydration) the selected tab draws its own underline.
        "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent group-data-[indicator=ready]/tabs:after:hidden",
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
      className={cn("animate-hl-fade pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", className)}
      {...props}
    />
  );
}
