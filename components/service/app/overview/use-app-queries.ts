"use client";

import { useQuery } from "@tanstack/react-query";
import { appPath, fetchJson } from "@/lib/service/app-read/client";
import type { AppOverviewDto, ReleasesPageDto } from "@/lib/service/app-read/types";

export const appKeys = {
  overview: (name: string) => ["app", name, "overview"] as const,
  releases: (name: string, page: number, count: number) => ["app", name, "releases", page, count] as const,
};

export function useOverview(name: string) {
  return useQuery({
    queryKey: appKeys.overview(name),
    queryFn: ({ signal }) => fetchJson<AppOverviewDto>(appPath(name, "overview"), signal),
    refetchInterval: 20_000,
  });
}

export function useReleasesPage(name: string, page: number, count = 10) {
  return useQuery({
    queryKey: appKeys.releases(name, page, count),
    queryFn: ({ signal }) => fetchJson<ReleasesPageDto>(`${appPath(name, "releases")}?page=${page}&count=${count}`, signal),
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
  });
}
