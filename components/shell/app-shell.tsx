"use client";

import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ShellUrlSync } from "./shell-url-sync";
import { TopBar, type TopBarProps } from "./top-bar";

export interface AppShellProps extends TopBarProps {
  children: ReactNode;
  /** Usually <ServicePanelSlot>; renders beside the main region (desktop) or as a bottom sheet (mobile). */
  servicePanel?: ReactNode;
  /** Classes for the main region, e.g. "p-0" for a full-bleed canvas. */
  mainClassName?: string;
}

/**
 * Application frame: top bar + main region + optional service panel.
 * The main region is scrollable and is the skip-link target (#main-content).
 */
export function AppShell({ children, servicePanel, mainClassName, ...topBar }: AppShellProps) {
  return (
    <div data-app-shell className="flex h-dvh flex-col overflow-clip">
      <TopBar {...topBar} />
      <div className="flex min-h-0 flex-1 overflow-clip">
        <main id="main-content" tabIndex={-1} className={cn("min-h-0 min-w-0 flex-1 overflow-auto outline-none", mainClassName)}>
          {children}
        </main>
        {servicePanel}
      </div>
      {/* useSearchParams needs a Suspense boundary under Cache Components. */}
      <Suspense fallback={null}>
        <ShellUrlSync />
      </Suspense>
    </div>
  );
}
