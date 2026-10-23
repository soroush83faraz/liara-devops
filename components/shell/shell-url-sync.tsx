"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { buildPanelSearch, parsePanelParams } from "./panel-params";
import { useShellStore } from "./shell-store";

/**
 * Two-way sync between `useShellStore().servicePanel` and `?service=&tab=`.
 * Must be rendered inside <Suspense> (AppShell does this). URL -> store runs when the query string changes;
 * store -> URL runs when the panel state changes and the URL does not already say the same thing.
 */
export function ShellUrlSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  // URL -> store
  useEffect(() => {
    const { service, tab } = parsePanelParams(queryString);
    const { servicePanel, hydrateFromUrl } = useShellStore.getState();
    const same =
      (servicePanel.open ? servicePanel.service : undefined) === service &&
      (service ? servicePanel.tab === tab : true);
    if (!same) hydrateFromUrl(service, tab);
  }, [queryString]);

  // store -> URL
  useEffect(() => {
    let previous = useShellStore.getState().servicePanel;
    return useShellStore.subscribe((state) => {
      const next = state.servicePanel;
      if (next === previous) return;
      const sameService = previous.open === next.open && previous.service === next.service;
      previous = next;
      const current = window.location.search;
      const target = buildPanelSearch(current, next);
      if (target === (current === "?" ? "" : current)) return;
      const href = `${pathname}${target}`;
      // Opening/closing is a navigation step (Back closes the panel); switching tabs just replaces.
      if (sameService) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }, [pathname, router]);

  return null;
}
