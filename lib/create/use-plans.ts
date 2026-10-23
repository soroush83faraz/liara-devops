"use client";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/service/app-read/client";
import type { PlansResponse } from "./types";

export const PLANS_KEY = ["create", "plans"] as const;

/** Plans, versions, networks and balance (server-cached ~60 s). Fetched only when a wizard is open. */
export function usePlans(enabled = true) {
  return useQuery({
    queryKey: PLANS_KEY,
    queryFn: ({ signal }) => fetchJson<PlansResponse>("/api/plans", signal),
    staleTime: 60_000,
    enabled,
  });
}

/** After creating something, bypass the server cache so new networks / balance show up. */
export async function refreshPlans(qc: QueryClient): Promise<void> {
  try {
    const fresh = await fetchJson<PlansResponse>("/api/plans?fresh=1");
    qc.setQueryData(PLANS_KEY, fresh);
  } catch {
    void qc.invalidateQueries({ queryKey: PLANS_KEY });
  }
}

/** Drop the canvas overview cache so the new service appears without waiting for the next poll. */
export function useAfterCreate() {
  const qc = useQueryClient();
  return async () => {
    void qc.invalidateQueries({ queryKey: ["overview"] });
    await refreshPlans(qc);
  };
}
