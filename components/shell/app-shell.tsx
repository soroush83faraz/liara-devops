"use client";

import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BottomTabs, Rail } from "./rail";
import { ShellUrlSync } from "./shell-url-sync";
import { TopBar, type TopBarProps } from "./top-bar";

export interface AppShellProps extends TopBarProps {
  children: ReactNode;
  /** Usually <ServicePanelSlot>; an overlay drawer over the main region (desktop) or a bottom sheet (mobile). */
  servicePanel?: ReactNode;
  /** Classes for the main region, e.g. "p-0" for a full-bleed canvas. */
  mainClassName?: string;
  /** Rail items from this index on are pinned to the rail's bottom (e.g. setup). */
  railSplitAt?: number;
}

/**
 * Application frame. Desktop: icon rail on the inline-start edge + slim top bar + main region (+ service panel).
 * Mobile: top bar + main region + bottom tab bar. The main region is the only scroller and is the skip-link
 * target (#main-content).
 */
export function AppShell({ children, servicePanel, mainClassName, railSplitAt, ...topBar }: AppShellProps) {
  const { navItems, user } = topBar;
  return (
    <div data-app-shell className="flex h-dvh overflow-clip bg-background">
      <Rail items={navItems} user={user} splitAt={railSplitAt} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar {...topBar} />
        {/* `relative`: the desktop service drawer and its scrim are positioned over this region (the main never resizes). */}
        <div className="relative flex min-h-0 flex-1 overflow-clip">
          <main
            id="main-content"
            tabIndex={-1}
            className={cn("min-h-0 min-w-0 flex-1 overflow-auto outline-none animate-hl-rise", mainClassName)}
          >
            {children}
          </main>
          {servicePanel}
        </div>
        {navItems?.length ? <BottomTabs items={navItems} /> : null}
      </div>
      {/* useSearchParams needs a Suspense boundary under Cache Components. */}
      <Suspense fallback={null}>
        <ShellUrlSync />
      </Suspense>
    </div>
  );
}
