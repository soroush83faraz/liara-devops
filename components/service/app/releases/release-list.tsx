"use client";

import { ChevronLeft, ChevronRight, GitBranch, Rocket } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { relativeTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { formatDuration } from "@/lib/service/app-read/format";
import type { ReleaseDto } from "@/lib/service/app-read/types";
import { QueryErrorBanner } from "../overview/unavailable";
import { ReleaseStateBadge } from "../overview/release-state-badge";
import { useReleasesPage } from "../overview/use-app-queries";

const r = fa.appOps.releases;
const PAGE_SIZE = 10;

function ReleaseRow({ release, onOpen }: { release: ReleaseDto; onOpen: () => void }) {
  const git = release.gitInfo;
  const tag = release.tag ?? release.id;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("appOps.releases.openRelease", { tag })}
        className="flex min-h-14 w-full flex-col gap-1.5 px-4 py-3 text-start transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex flex-wrap items-center gap-2">
          <bdi dir="ltr" className="font-mono text-sm font-semibold">{tag}</bdi>
          <ReleaseStateBadge state={release.state} />
          {release.isCurrent ? <Badge tone="accent">{r.current}</Badge> : null}
          {release.queue ? <span className="text-xs text-muted">{t("appOps.releases.queue", { count: release.queue })}</span> : null}
        </span>
        {git?.branch || git?.commit ? (
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <GitBranch aria-hidden className="size-3.5" />
            {git.branch ? <bdi dir="ltr" className="font-mono">{git.branch}</bdi> : null}
            {git.commit ? <bdi dir="ltr" className="font-mono">{git.commit.slice(0, 7)}</bdi> : null}
            {git.message ? <bdi dir="ltr" className="max-w-full truncate">{git.message}</bdi> : null}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted">
          {release.createdAt ? <span>{relativeTime(release.createdAt)}</span> : null}
          <span>
            {r.duration}: {formatDuration(release.durationMs)}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ReleaseList({ name, page, onPage, onOpen }: { name: string; page: number; onPage: (p: number) => void; onOpen: (id: string) => void }) {
  const q = useReleasesPage(name, page, PAGE_SIZE);
  if (q.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (q.isError) return <QueryErrorBanner error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  const { releases, total } = q.data;
  if (releases.length === 0 && page === 1) {
    return <EmptyState icon={<Rocket />} title={r.empty} description={r.emptyHint} />;
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-border">
          {releases.map((x) => (
            <ReleaseRow key={x.id} release={x} onOpen={() => onOpen(x.id)} />
          ))}
        </ul>
      </Card>
      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-2" aria-label={r.title}>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronRight aria-hidden className="size-4" />
            {r.prev}
          </Button>
          <span className="text-sm text-muted">{t("appOps.releases.page", { page, pages })}</span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            {r.next}
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
