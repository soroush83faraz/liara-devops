"use client";

// Everything the browser tab keeps in memory about ONE Liara account. The tab (and its QueryClient, 5 min gcTime) lives
// across a disconnect and a reconnect as another account, so it must be wiped on both, or account A's services,
// metrics, health results or copilot chats could be shown to account B. Per-account localStorage entries are keyed by
// account id (canvas layout, observability hidden services) and are not shared, so they stay.
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useShellStore } from "@/components/shell/shell-store";
import { useHealthStore } from "@/lib/canvas/health-store";
import { useCopilotStore } from "@/lib/copilot/store";
import { useCreateStore } from "@/lib/create/store";

export function resetAccountClientState(queryClient: Pick<QueryClient, "cancelQueries" | "clear">): void {
  void queryClient.cancelQueries();
  queryClient.clear();
  useHealthStore.setState({ byService: {}, alerts: [], sessionExpired: false });
  useCopilotStore.getState().resetAll();
  useShellStore.getState().closeService();
  useCreateStore.getState().close();
}

/** Call right after a successful disconnect and a successful connect, before navigating. */
export function useResetAccountState(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => resetAccountClientState(queryClient), [queryClient]);
}
