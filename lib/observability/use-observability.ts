"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/service/app-read/client";
import type { MetricRange } from "@/lib/service/app-read/types";
import { OBSERVABILITY_REFRESH_MS, type ObsErrorsDto, type ObservabilityDto } from "./types";

function url(base: string, range: MetricRange, network: string | null): string {
  const qs = new URLSearchParams({ range });
  if (network) qs.set("network", network);
  return `${base}?${qs.toString()}`;
}

/**
 * Metrics and error lines are two requests so that the slow log scan never delays the charts. Both refetch every 30 s
 * unless paused (TanStack also pauses interval refetching while the tab is hidden). A new range/network is a new query
 * key on purpose: the old window's charts are never shown under the new label.
 */
export function useObservability({ accountId, range, network, paused }: { accountId: string; range: MetricRange; network: string | null; paused: boolean }) {
  const refetchInterval = paused ? false : OBSERVABILITY_REFRESH_MS;
  const metrics = useQuery({
    queryKey: ["observability", accountId, "metrics", range, network],
    queryFn: ({ signal }) => fetchJson<ObservabilityDto>(url("/api/observability", range, network), signal),
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
  const errors = useQuery({
    queryKey: ["observability", accountId, "errors", range, network],
    queryFn: ({ signal }) => fetchJson<ObsErrorsDto>(url("/api/observability/errors", range, network), signal),
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
  return { metrics, errors };
}
