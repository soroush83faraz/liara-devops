"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { DIR } from "@/components/ui/dir";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { duration, ease, spring } from "@/lib/ui/motion";
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

/** The drawer sits on the inline-END edge: left in RTL, so it slides in from the left (negative x). */
const OFFSCREEN = DIR === "rtl" ? "-100%" : "100%";

/** Header content, or a function of the service id (so it stays filled while the drawer slides out). */
type Slot = ReactNode | ((service: string) => ReactNode);

/**
 * Where service details render. Pass it to AppShell as `servicePanel`:
 *
 *   <AppShell servicePanel={<ServicePanelSlot title="my-app">{({ service, tab }) => <MyTabs ... />}</ServicePanelSlot>}>
 *
 * Open/close it from anywhere with `useShellStore.getState().openService(id, tab)`.
 * >= 1024px: an overlay drawer on the inline-end edge over a dimmed scrim (the page underneath never resizes);
 * Esc or a click on the scrim closes it, focus moves in on open and back to where it was on close.
 * Below 1024px: a bottom sheet.
 */
export function ServicePanelSlot({
  children,
  title,
  subtitle,
  leading,
  className,
}: {
  children: ReactNode | ((ctx: ServicePanelContext) => ReactNode);
  title?: Slot;
  /** One muted line under the title (kind, platform, status). */
  subtitle?: Slot;
  /** Visual before the title, e.g. the service's icon tile (decorative). */
  leading?: Slot;
  className?: string;
}) {
  const { open, service, tab } = useShellStore((s) => s.servicePanel);
  const setTab = useShellStore((s) => s.setTab);
  const closeService = useShellStore((s) => s.closeService);
  const setPanelWidth = useShellStore((s) => s.setPanelWidth);
  const desktop = useIsDesktop();

  // Restore the remembered width once (per-viewer convenience; falls back silently).
  useEffect(() => {
    const stored = readStoredWidth();
    if (stored) setPanelWidth(stored);
  }, [setPanelWidth]);

  const isOpen = open && !!service;
  // While the drawer slides out the store is already closed: keep rendering the service it was showing.
  const [shown, setShown] = useState<{ service?: string; tab?: string }>({ service, tab });
  if (isOpen && (shown.service !== service || shown.tab !== tab)) setShown({ service, tab });
  const current = isOpen ? service : shown.service;
  const currentTab = isOpen ? tab : shown.tab;
  const content = current
    ? typeof children === "function"
      ? children({ service: current, tab: currentTab, setTab, close: closeService })
      : children
    : null;
  const resolve = (slot: Slot | undefined) => (typeof slot === "function" ? (current ? slot(current) : null) : slot);
  const heading = resolve(title) ?? current;
  const subline = resolve(subtitle);
  const lead = resolve(leading);

  if (!desktop) {
    if (!isOpen) return null;
    return (
      <Sheet open onOpenChange={(next) => !next && closeService()}>
        <SheetContent side="bottom" title={heading} description={subline ?? undefined} className={cn("h-[85dvh]", className)}>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <Drawer key="service-drawer" heading={heading} subtitle={subline} leading={lead} onClose={closeService} className={className}>
          {content}
        </Drawer>
      ) : null}
    </AnimatePresence>
  );
}

function Drawer({
  heading,
  subtitle,
  leading,
  onClose,
  className,
  children,
}: {
  heading: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const width = useShellStore((s) => s.panelWidth);
  const setPanelWidth = useShellStore((s) => s.setPanelWidth);
  const service = useShellStore((s) => s.servicePanel.service);
  const asideRef = useRef<HTMLElement>(null);

  // The page under the scrim is out of reach while the drawer is open (no tabbing into a dimmed canvas);
  // on close, focus goes back to whatever opened the drawer.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const main = document.getElementById("main-content");
    if (main) main.inert = true;
    return () => {
      if (main) main.inert = false;
      if (opener && opener.isConnected && !asideRef.current?.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  // Focus the drawer on open and whenever it switches to another service.
  useEffect(() => {
    if (service) asideRef.current?.focus({ preventScroll: true });
  }, [service]);

  return (
    <>
      <motion.div
        aria-hidden
        data-panel-scrim
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: duration.base, ease: ease.out }}
        onClick={onClose}
        className="absolute inset-0 z-30 bg-overlay"
      />
      <motion.aside
        ref={asideRef}
        tabIndex={-1}
        aria-label={t("shell.servicePanel")}
        initial={{ x: OFFSCREEN }}
        animate={{ x: 0 }}
        exit={{ x: OFFSCREEN, transition: { duration: duration.base, ease: ease.inOut } }}
        transition={spring.panel}
        onKeyDown={(e) => {
          // Portaled children (select menus, tooltips) bubble through React; only react to keys from inside the panel.
          if (e.key === "Escape" && !e.defaultPrevented && asideRef.current?.contains(e.target as Node)) onClose();
        }}
        // A programmatically focused container needs no ring (the global :focus-visible rule would draw one).
        style={{ width: `min(${width}px, 100vw)`, outline: "none" }}
        className={cn(
          "absolute inset-y-0 end-0 z-40 flex min-h-0 flex-col border-s border-border bg-surface shadow-[var(--shadow-pop)] outline-none",
          className,
        )}
      >
        <ResizeHandle width={width} onResize={setPanelWidth} onCommit={storeWidth} asideRef={asideRef} />
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          {leading}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-bold leading-6">{heading}</h2>
            {subtitle ? <div className="truncate text-xs leading-5 text-muted">{subtitle}</div> : null}
          </div>
          <IconButton label={t("shell.closePanel")} icon={<X aria-hidden className="size-5" />} onClick={onClose} className="-me-1" />
        </header>
        <div data-panel-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </motion.aside>
    </>
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
      // The drawer sits on the end edge: in RTL its left edge is fixed, in LTR its right edge.
      const next = isRtl() ? e.clientX - rect.left : rect.right - e.clientX;
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
    // The handle is on the drawer's inner (start) edge, so the arrow pointing away from the drawer widens it.
    const grow = isRtl() ? "ArrowRight" : "ArrowLeft";
    const shrink = isRtl() ? "ArrowLeft" : "ArrowRight";
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
      className="group absolute inset-y-0 start-0 z-10 flex w-2.5 cursor-col-resize touch-none items-center justify-center outline-none ltr:-translate-x-1/2 rtl:translate-x-1/2"
    >
      <span
        aria-hidden
        className="h-10 w-1 rounded-full bg-border-strong/0 transition-colors duration-150 group-hover:bg-border-strong/70 group-focus-visible:bg-accent group-active:bg-accent"
      />
    </div>
  );
}
