"use client";

import { useState } from "react";
import type { AppPanelProps } from "@/lib/service/app-read/types";
import { ReleaseDetail } from "./release-detail";
import { ReleaseList } from "./release-list";

/** Paginated releases; selecting one opens its detail with a live (SSE) or static build log. */
export function ReleasesTab({ name }: AppPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  if (selected) return <ReleaseDetail appName={name} releaseId={selected} onBack={() => setSelected(null)} />;
  return <ReleaseList name={name} page={page} onPage={setPage} onOpen={setSelected} />;
}
