"use client";

import { FileUp, KeyRound, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { emptyAwareDir } from "@/components/ui/dir";
import { Button, EmptyState, Input } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { useEnvList } from "@/lib/service/app-config/client";
import { ListSkeleton, LoadError } from "@/lib/service/app-config/ui/load-state";
import type { AppPanelProps } from "@/lib/service/app-read/types";
import { EnvDeleteDialog } from "./env-delete-dialog";
import { EnvFormDialog } from "./env-form-dialog";
import { EnvImportDialog } from "./env-import-dialog";
import { EnvRow } from "./env-row";
import { RevealDialog } from "./reveal-dialog";

type Editing = { mode: "add" } | { mode: "edit"; key: string };

/** Environment variables: masked list, add/edit/delete, `.env` import, reveal-on-demand. */
export function VariablesTab({ name }: AppPanelProps) {
  const q = useEnvList(name);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState(false);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const envs = q.data?.envs;
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (envs ?? []).filter((e) => (f ? e.key.toLowerCase().includes(f) : true));
  }, [envs, filter]);
  const existingKeys = useMemo(() => (envs ?? []).map((e) => e.key), [envs]);

  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="vars-title">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="vars-title" className="text-lg font-semibold">
            {t("appConfig.vars.title")}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
              <FileUp aria-hidden className="size-4" />
              {t("appConfig.vars.importButton")}
            </Button>
            <Button size="sm" onClick={() => setEditing({ mode: "add" })}>
              <Plus aria-hidden className="size-4" />
              {t("appConfig.vars.add")}
            </Button>
          </div>
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
          <RefreshCw aria-hidden className="mt-1 size-4 shrink-0" />
          {t("appConfig.vars.restartNotice")}
        </p>
      </header>

      {q.isPending ? <ListSkeleton /> : null}
      {q.isError ? <LoadError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}

      {envs && envs.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title={t("appConfig.vars.emptyTitle")}
          description={t("appConfig.vars.emptyBody")}
          action={
            <Button onClick={() => setEditing({ mode: "add" })}>
              <Plus aria-hidden className="size-4" />
              {t("appConfig.vars.add")}
            </Button>
          }
        />
      ) : null}

      {envs && envs.length > 0 ? (
        <>
          {envs.length > 8 ? (
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                dir={emptyAwareDir(filter, "ltr")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("appConfig.vars.filter")}
                aria-label={t("appConfig.vars.filter")}
                className="ps-9 text-start"
              />
            </div>
          ) : null}
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface" aria-label={t("appConfig.vars.listLabel")}>
            {shown.map((e) => (
              <EnvRow
                key={e.key}
                env={e}
                onReveal={() => setRevealKey(e.key)}
                onEdit={() => setEditing({ mode: "edit", key: e.key })}
                onDelete={() => setDeleteKey(e.key)}
              />
            ))}
            {shown.length === 0 ? <li className="p-4 text-sm text-muted">{t("appConfig.vars.noMatch")}</li> : null}
          </ul>
          <p className="text-xs leading-6 text-muted">{t("appConfig.vars.countNote", { count: envs.length })}</p>
        </>
      ) : null}

      {editing ? (
        <EnvFormDialog
          appName={name}
          mode={editing.mode}
          editKey={editing.mode === "edit" ? editing.key : undefined}
          existingKeys={existingKeys}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? <EnvImportDialog appName={name} existingKeys={existingKeys} onClose={() => setImporting(false)} /> : null}
      {revealKey ? <RevealDialog appName={name} envKey={revealKey} onClose={() => setRevealKey(null)} /> : null}
      {deleteKey ? <EnvDeleteDialog appName={name} envKey={deleteKey} onClose={() => setDeleteKey(null)} /> : null}
    </section>
  );
}
