"use client";

import { useQuery } from "@tanstack/react-query";
import { dbKeys, dbPath, fetchJson } from "@/lib/service/db/client";
import type { DbConnectionDto } from "@/lib/service/db/connection";
import type { DbOverviewDto } from "@/lib/service/db/types";

export function useDbOverview(host: string) {
  return useQuery({
    queryKey: dbKeys.overview(host),
    queryFn: ({ signal }) => fetchJson<DbOverviewDto>(dbPath(host, "overview"), signal),
    refetchInterval: 20_000,
  });
}

/** The connection DTO never contains the password (strings use the `<PASSWORD>` placeholder). */
export function useDbConnection(host: string) {
  return useQuery({
    queryKey: dbKeys.connection(host),
    queryFn: ({ signal }) => fetchJson<DbConnectionDto>(dbPath(host, "connection"), signal),
    refetchInterval: 60_000,
  });
}
