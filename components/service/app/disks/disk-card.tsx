"use client";

import { HardDrive, Maximize2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { runOp } from "@/lib/client/ops";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { DiskDto } from "@/lib/service/app-config/dto";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";
import { ResizeDiskDialog } from "./resize-disk-dialog";

export function DiskCard({ appName, disk }: { appName: string; disk: DiskDto }) {
  const done = useAfterMutation(appName);
  const [resizing, setResizing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <HardDrive aria-hidden className="size-5 shrink-0 text-muted" />
          <bdi dir="ltr" className="break-all font-mono text-[15px] font-semibold">
            {disk.name}
          </bdi>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {typeof disk.sizeGb === "number" ? (
            <Badge tone="neutral">{t("appConfig.disks.sizeGb", { size: faNumber(disk.sizeGb) })}</Badge>
          ) : null}
          {disk.mountedTo ? (
            <Badge tone="accent">
              {t("appConfig.disks.mountedAt")} <bdi dir="ltr">{disk.mountedTo}</bdi>
            </Badge>
          ) : (
            <Badge tone="neutral">{t("appConfig.disks.notMounted")}</Badge>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setResizing(true)}>
          <Maximize2 aria-hidden className="size-4" />
          {t("appConfig.disks.resize.action")}
        </Button>
        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting(true)}>
          <Trash2 aria-hidden className="size-4" />
          {t("common.delete")}
        </Button>
      </div>

      {resizing ? <ResizeDiskDialog appName={appName} disk={disk} onClose={() => setResizing(false)} /> : null}
      {deleting ? (
        <OpDialog
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(false);
          }}
          title={t("appConfig.disks.delete.title")}
          operation={t("appConfig.disks.delete.operation")}
          target={disk.name}
          effect={t("appConfig.disks.delete.effect")}
          risk={t("appConfig.disks.delete.risk")}
          reversible="no"
          typedName={disk.name}
          danger
          confirmLabel={t("appConfig.disks.delete.confirm")}
          onConfirm={async () => {
            await runOp({ params: { type: "delete_disk", app: appName, disk: disk.name }, typedName: disk.name });
            done(t("appConfig.disks.delete.toast"));
          }}
        />
      ) : null}
    </li>
  );
}
