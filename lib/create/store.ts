"use client";
// Tiny store that decides which create dialog is open. Anywhere in the app (e.g. the Releases tab):
//   import { openDeployDialog } from "@/lib/create/store";
//   openDeployDialog("my-app");
import { create } from "zustand";

export type CreateDialog =
  | { kind: "network" }
  | { kind: "app"; network?: string }
  | { kind: "db"; network?: string }
  | { kind: "deploy"; appName: string; platform?: string };

interface CreateStore {
  dialog: CreateDialog | null;
  open: (dialog: CreateDialog) => void;
  close: () => void;
}

export const useCreateStore = create<CreateStore>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

export const openNetworkDialog = (): void => useCreateStore.getState().open({ kind: "network" });
export const openAppDialog = (network?: string): void => useCreateStore.getState().open({ kind: "app", network });
export const openDbDialog = (network?: string): void => useCreateStore.getState().open({ kind: "db", network });
/** Opens the «انتشار نسخه‌ی جدید» flow for an existing app. `platform` only pre-selects the platform/port hint. */
export const openDeployDialog = (appName: string, platform?: string): void =>
  useCreateStore.getState().open({ kind: "deploy", appName, platform });
