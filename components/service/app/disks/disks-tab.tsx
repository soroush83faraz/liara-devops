"use client";

import { HardDrive, Plus } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { useDiskList } from "@/lib/service/app-config/client";
import type { DiskDto } from "@/lib/service/app-config/dto";
import { ListSkeleton, LoadError } from "@/lib/service/app-config/ui/load-state";
import type { AppPanelProps } from "@/lib/service/app-read/types";
import { CreateDiskDialog } from "./create-disk-dialog";
import { DiskCard } from "./disk-card";

/** Persistent disks of the app: list, create (billed), resize (grow only), delete. */
export function DisksTab({ name }: AppPanelProps) {
  const q = useDiskList(name);
  const [creating, setCreating] = useState(false);
  const disks: DiskDto[] | undefined = q.data?.disks;
  const reserved = q.data?.reservedDiskSpace;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="disks-title">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="disks-title" className="text-lg font-semibold">
            {t("appConfig.disks.title")}
          </h2>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            {t("appConfig.disks.addButton")}
          </Button>
        </div>
        {typeof reserved === "number" ? (
          <p className="text-sm text-muted">{t("appConfig.disks.reserved", { size: faNumber(reserved) })}</p>
        ) : null}
        <p className="text-xs leading-6 text-muted">{t("appConfig.disks.mountNote")}</p>
      </header>

      {q.isPending ? <ListSkeleton rows={2} /> : null}
      {q.isError ? <LoadError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}

      {disks && disks.length === 0 ? (
        <EmptyState
          icon={<HardDrive />}
          title={t("appConfig.disks.emptyTitle")}
          description={t("appConfig.disks.emptyBody")}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" />
              {t("appConfig.disks.addButton")}
            </Button>
          }
        />
      ) : null}

      {disks && disks.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {disks.map((d) => (
            <DiskCard key={d.name} appName={name} disk={d} />
          ))}
        </ul>
      ) : null}

      {creating ? <CreateDiskDialog appName={name} onClose={() => setCreating(false)} /> : null}
    </section>
  );
}
