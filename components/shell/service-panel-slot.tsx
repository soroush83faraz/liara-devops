"use client";

import { GripVertical, X } from "lucide-react";
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  clampPanelWidth,
  useShellStore,
} from "./shell-store";
import { useIsDesktop } from "./use-media-query";

export interface ServicePanelContext {
  service: string;
  tab?: string;
  setTab: (tab: string) => void;
  close: () => void;
}

const WIDTH_KEY = "hl.panelWidth";

function readStoredWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clampPanelWidth(n) : null;
  } catch {
    return null;
  }
}

function storeWidth(width: number) {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // storage unavailable (private mode): width simply is not remembered
  }
}

/**
 * Where service details render. Pass it to AppShell as `servicePanel`:
 *
 *   <AppShell servicePanel={<ServicePanelSlot title="my-app">{({ service, tab }) => <MyTabs ... />}</ServicePanelSlot>}>
 *
 * Open/close it from anywhere with `useShellStore.getState().openService(id, tab)`.
 * >= 1024px: resizable side panel on the reading-start edge (right in RTL). Below: a bottom sheet.
 */
export function ServicePanelSlot({
  children,
  title,
  className,
}: {
  children: ReactNode | ((ctx: ServicePanelContext) => ReactNode);
  title?: ReactNode;
  className?: string;
}) {
  const { open, service, tab } = useShellStore((s) => s.servicePanel);
  const setTab = useShellStore((s) => s.setTab);
  const closeService = useShellStore((s) => s.closeService);
  const width = useShellStore((s) => s.panelWidth);
  const setPanelWidth = useShellStore((s) => s.setPanelWidth);
  const desktop = useIsDesktop();
  const asideRef = useRef<HTMLElement>(null);

  // Restore the remembered width once (per-viewer convenience; falls back silently).
  useEffect(() => {
    const stored = readStoredWidth();
    if (stored) setPanelWidth(stored);
  }, [setPanelWidth]);

  // Move focus into the panel when it opens on desktop (the mobile Sheet manages its own focus).
  useEffect(() => {
    if (open && desktop) asideRef.current?.focus();
  }, [open, service, desktop]);

  const content =
    open && service
      ? typeof children === "function"
        ? children({ service, tab, setTab, close: closeService })
        : children
      : null;

  if (!open || !service) return null;
  const heading = title ?? service;

  if (!desktop) {
    return (
      <Sheet open onOpenChange={(next) => !next && closeService()}>
        <SheetContent side="bottom" title={heading} className={cn("h-[85dvh]", className)}>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label={t("shell.servicePanel")}
      onKeyDown={(e) => {
        // Portaled children (select menus, tooltips) bubble through React; only react to keys from inside the panel.
        if (e.key === "Escape" && !e.defaultPrevented && asideRef.current?.contains(e.target as Node)) closeService();
      }}
      style={{ width }}
      className={cn(
        "relative order-first flex min-h-0 shrink-0 flex-col border-e border-border bg-surface outline-none",
        className,
      )}
    >
      <ResizeHandle width={width} onResize={setPanelWidth} onCommit={storeWidth} asideRef={asideRef} />
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <h2 className="min-w-0 truncate text-base font-semibold">{heading}</h2>
        <IconButton label={t("shell.closePanel")} icon={<X aria-hidden className="size-5" />} onClick={closeService} />
      </header>
      <div data-panel-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{content}</div>
    </aside>
  );
}

function ResizeHandle({
  width,
  onResize,
  onCommit,
  asideRef,
}: {
  width: number;
  onResize: (n: number) => void;
  onCommit: (n: number) => void;
  asideRef: React.RefObject<HTMLElement | null>;
}) {
  const dragging = useRef(false);

  const isRtl = () => document.documentElement.dir === "rtl" || getComputedStyle(document.documentElement).direction === "rtl";

  const move = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !asideRef.current) return;
      const rect = asideRef.current.getBoundingClientRect();
      // The panel sits on the start edge: in RTL its right edge is fixed, in LTR its left edge.
      const next = isRtl() ? rect.right - e.clientX : e.clientX - rect.left;
      onResize(next);
    },
    [asideRef, onResize],
  );

  const end = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      onCommit(useShellStore.getState().panelWidth);
    },
    [onCommit],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    // The handle is on the inner (end) edge, so the arrow pointing away from the panel widens it.
    const grow = isRtl() ? "ArrowLeft" : "ArrowRight";
    const shrink = isRtl() ? "ArrowRight" : "ArrowLeft";
    let next: number | null = null;
    if (e.key === grow) next = width + step;
    else if (e.key === shrink) next = width - step;
    else if (e.key === "Home") next = PANEL_MIN_WIDTH;
    else if (e.key === "End") next = PANEL_MAX_WIDTH;
    if (next === null) return;
    e.preventDefault();
    const clamped = clampPanelWidth(next);
    onResize(clamped);
    onCommit(clamped);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("shell.resizePanel")}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 end-0 z-10 flex w-3 translate-x-0 cursor-col-resize touch-none items-center justify-center outline-none ltr:translate-x-1/2 rtl:-translate-x-1/2 focus-visible:bg-accent-soft hover:bg-accent-soft"
    >
      <GripVertical aria-hidden className="size-4 text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>
  );
}
