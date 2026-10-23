"use client";

import { create } from "zustand";

export interface ServicePanelState {
  open: boolean;
  service?: string;
  tab?: string;
}

export const PANEL_MIN_WIDTH = 360;
export const PANEL_MAX_WIDTH = 760;
export const PANEL_DEFAULT_WIDTH = 560;

interface ShellStore {
  servicePanel: ServicePanelState;
  /** Desktop width of the service panel in px (resizable). */
  panelWidth: number;
  openService: (service: string, tab?: string) => void;
  closeService: () => void;
  setTab: (tab: string) => void;
  setPanelWidth: (width: number) => void;
  /** Used by the URL sync only: applies state read from the query string. */
  hydrateFromUrl: (service?: string, tab?: string) => void;
}

export const clampPanelWidth = (n: number) => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(n)));

/**
 * Shell UI state. Other units open the service panel with
 * `useShellStore.getState().openService("my-app", "logs")`; the URL (`?service=&tab=`) follows automatically.
 */
export const useShellStore = create<ShellStore>((set) => ({
  servicePanel: { open: false },
  panelWidth: PANEL_DEFAULT_WIDTH,
  openService: (service, tab) => set({ servicePanel: { open: true, service, tab } }),
  closeService: () => set({ servicePanel: { open: false } }),
  setTab: (tab) => set((s) => (s.servicePanel.open ? { servicePanel: { ...s.servicePanel, tab } } : s)),
  setPanelWidth: (width) => set({ panelWidth: clampPanelWidth(width) }),
  hydrateFromUrl: (service, tab) =>
    set(() => (service ? { servicePanel: { open: true, service, tab } } : { servicePanel: { open: false } })),
}));
