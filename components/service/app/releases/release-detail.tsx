"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleX } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, KeyValueList, Skeleton, type KeyValueItem } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { faDateTime, relativeTime } from "@/lib/i18n/format";
import { fetchJson } from "@/lib/service/app-read/client";
import { formatDuration } from "@/lib/service/app-read/format";
import type { ReleaseDto } from "@/lib/service/app-read/types";
import { ReleaseStateBadge } from "../overview/release-state-badge";
import { QueryErrorBanner } from "../overview/unavailable";
import { BuildLogPanel } from "./build-log-panel";
import { ReleaseActionsSlot } from "./release-actions-slot";

const r = fa.appOps.releases;

function useRelease(id: string) {
  return useQuery({
    queryKey: ["release", id],
    queryFn: ({ signal }) => fetchJson<ReleaseDto>(`/api/releases/${encodeURIComponent(id)}`, signal),
    refetchInterval: (q) => (q.state.data?.live ? 3000 : false),
  });
}

function FailReason({ text }: { text?: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger-soft p-4 text-danger-ink">
      <CircleX aria-hidden className="mt-1 size-5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold leading-8">{r.failReason}</p>
        {text ? (
          <bdi dir="ltr" className="block break-words font-mono text-sm leading-7">
            {text}
          </bdi>
        ) : (
          <p className="text-sm leading-7">{r.failReasonUnknown}</p>
        )}
      </div>
    </div>
  );
}

function Facts({ release }: { release: ReleaseDto }) {
  const g = release.gitInfo;
  const items: KeyValueItem[] = [
    { key: r.tag, value: release.tag ?? release.id, ltr: true, copy: release.tag ?? release.id },
    { key: r.time, value: release.createdAt ? `${faDateTime(release.createdAt)} (${relativeTime(release.createdAt)})` : fa.common.dash },
    { key: r.duration, value: formatDuration(release.durationMs) },
    ...(g?.branch ? [{ key: r.gitBranch, value: g.branch, ltr: true }] : []),
    ...(g?.commit ? [{ key: r.gitCommit, value: g.commit, ltr: true, copy: g.commit }] : []),
    ...(g?.author ? [{ key: r.gitAuthor, value: g.author, ltr: true }] : []),
    ...(g?.message ? [{ key: r.gitMessage, value: g.message, ltr: true }] : []),
  ];
  return <KeyValueList items={items} />;
}

export function ReleaseDetail({ appName, releaseId, onBack }: { appName: string; releaseId: string; onBack: () => void }) {
  const q = useRelease(releaseId);
  const back = (
    <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
      <ArrowRight aria-hidden className="size-4" />
      {r.back}
    </Button>
  );
  if (q.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        {back}
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <QueryErrorBanner error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      </div>
    );
  }
  const release = q.data;
  const failed = ["FAILED", "UNHEALTHY", "TIMEDOUT"].includes(release.state.toUpperCase());
  return (
    <div className="flex flex-col gap-4">
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="sr-only">{r.detail}</h3>
        <bdi dir="ltr" className="font-mono text-base font-semibold">{release.tag ?? release.id}</bdi>
        <ReleaseStateBadge state={release.state} />
        {release.isCurrent ? <Badge tone="accent">{r.current}</Badge> : null}
      </div>
      {failed || release.failReason ? <FailReason text={release.failReason} /> : null}
      <Card>
        <CardContent className="py-2">
          <Facts release={release} />
        </CardContent>
      </Card>
      <ReleaseActionsSlot appName={appName} release={release} />
      <Card>
        <CardHeader>
          <CardTitle>{r.buildLogs}</CardTitle>
        </CardHeader>
        <CardContent>
          <BuildLogPanel key={release.id} release={release} appName={appName} />
        </CardContent>
      </Card>
    </div>
  );
}
