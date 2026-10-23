"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ExternalLink, Info, Link2 } from "lucide-react";
import { useState } from "react";
import { Button, CopyButton, EmptyState, Skeleton, useToast } from "@/components/ui";
import { faDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { dbKeys, dbPath, fetchJson, postJson } from "@/lib/service/db/client";
import { formatBytes, isSafeHttpUrl } from "@/lib/service/db/format";
import type { DbBackupsDto } from "@/lib/service/db/types";
import { errorMessage, QueryError, SectionCard, type DbPanelProps } from "./shared";

function BackupRow({ host, name, size, lastModified }: { host: string; name: string; size?: number; lastModified?: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkMutation = useMutation({
    // The signed link is kept in component state only, never in the query cache.
    gcTime: 0,
    mutationFn: () => postJson<{ link?: string }>(dbPath(host, `backups/${encodeURIComponent(name)}/link`), {}),
    onSuccess: (res) => {
      setError(null);
      setLink(typeof res.link === "string" && isSafeHttpUrl(res.link) ? res.link : null);
      if (!res.link || !isSafeHttpUrl(res.link)) setError(t("dbPanel.backups.linkFailed"));
    },
    onError: (e) => setError(`${t("dbPanel.backups.linkFailed")}: ${errorMessage(e)}`),
  });

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <bdi dir="ltr" className="min-w-0 break-all font-mono text-sm">{name}</bdi>
        <Button variant="secondary" size="sm" onClick={() => linkMutation.mutate()} loading={linkMutation.isPending} loadingText={t("dbPanel.backups.gettingLink")}>
          <Link2 aria-hidden className="size-4" />
          {t("dbPanel.backups.getLink")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          {t("dbPanel.backups.size")}: {formatBytes(size)}
        </span>
        <span>
          {t("dbPanel.backups.date")}: {lastModified ? faDateTime(lastModified) : "—"}
        </span>
      </div>
      {link ? (
        <div role="status" className="flex flex-col gap-2 rounded-sm border border-border bg-surface-muted p-3">
          <p className="text-sm font-medium">{t("dbPanel.backups.linkReady")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border-strong/50 bg-surface px-3 text-sm font-medium hover:bg-surface-muted md:min-h-9"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t("dbPanel.backups.open")}
            </a>
            <CopyButton value={link} label={t("dbPanel.backups.copyLink")} size="sm" />
          </div>
          <p className="text-xs leading-6 text-muted">{t("dbPanel.backups.linkNote")}</p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm leading-6 text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function DbBackupsTab({ name }: DbPanelProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: dbKeys.backups(name),
    queryFn: ({ signal }) => fetchJson<DbBackupsDto>(dbPath(name, "backups"), signal),
    refetchInterval: 30_000,
  });
  const create = useMutation({
    mutationFn: () => postJson(dbPath(name, "backups"), {}),
    onSuccess: () => {
      toast({ variant: "success", title: t("dbPanel.backups.created"), description: t("dbPanel.backups.createdBody") });
      void qc.invalidateQueries({ queryKey: dbKeys.backups(name) });
    },
    onError: (e) => toast({ variant: "error", title: t("dbPanel.common.actionFailed"), description: errorMessage(e) }),
  });

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title={t("dbPanel.backups.title")} icon={<Archive />}>
        <div className="flex flex-col gap-3">
          <div>
            <Button onClick={() => create.mutate()} loading={create.isPending} loadingText={t("dbPanel.backups.creating")}>
              {t("dbPanel.backups.create")}
            </Button>
          </div>
          {q.isPending ? (
            <div aria-busy="true" className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : q.isError ? (
            <QueryError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
          ) : q.data.backups.length === 0 ? (
            <EmptyState icon={<Archive />} title={t("dbPanel.backups.empty")} description={t("dbPanel.backups.emptyBody")} />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {q.data.backups.map((b) => (
                  <BackupRow key={b.name} host={name} name={b.name} size={b.size} lastModified={b.lastModified} />
                ))}
              </ul>
              <p className="text-xs leading-6 text-muted">{t("dbPanel.backups.sizeUnit")}</p>
            </>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t("dbPanel.backups.restoreTitle")} icon={<Info />}>
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-7">{t("dbPanel.backups.restoreBody")}</p>
          <div>
            <a
              href="https://console.liara.ir"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border-strong/50 bg-surface px-3 text-sm font-medium hover:bg-surface-muted md:min-h-9"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t("dbPanel.backups.openConsole")}
            </a>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
