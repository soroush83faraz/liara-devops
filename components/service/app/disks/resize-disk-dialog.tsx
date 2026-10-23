"use client";

import { useState } from "react";
import { Button, Dialog, DialogContent, Field, Input } from "@/components/ui";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { appPath, postJson } from "@/lib/service/app-config/client";
import { diskSizeCheck } from "@/lib/service/app-config/disks";
import type { DiskDto } from "@/lib/service/app-config/dto";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";

const SIZE_ISSUE = {
  empty: "appConfig.disks.sizeIssue.empty",
  not_integer: "appConfig.disks.sizeIssue.notInteger",
  range: "appConfig.disks.sizeIssue.range",
  not_larger: "appConfig.disks.sizeIssue.notLarger",
} as const;

/** Tier 2: grow only; new size first, then the typed disk name. */
export function ResizeDiskDialog({ appName, disk, onClose }: { appName: string; disk: DiskDto; onClose: () => void }) {
  const done = useAfterMutation(appName);
  const [size, setSize] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  const check = diskSizeCheck(size, disk.sizeGb);

  if (confirm !== null) {
    return (
      <OpDialog
        open
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={t("appConfig.disks.resize.title")}
        operation={t("appConfig.disks.resize.operation", { from: faNumber(disk.sizeGb ?? 0), to: confirm })}
        target={disk.name}
        effect={t("appConfig.disks.resize.effect")}
        risk={t("appConfig.disks.resize.risk")}
        reversible="no"
        cost={t("appConfig.disks.costNote")}
        typedName={disk.name}
        confirmLabel={t("appConfig.disks.resize.confirm")}
        onConfirm={async () => {
          await postJson(`${appPath(appName, "disks")}/${encodeURIComponent(disk.name)}/resize`, {
            sizeGb: confirm,
            typedName: disk.name,
          });
          done(t("appConfig.disks.resize.toast"));
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        title={t("appConfig.disks.resize.title")}
        description={
          typeof disk.sizeGb === "number" ? t("appConfig.disks.resize.current", { size: disk.sizeGb }) : t("appConfig.disks.resize.currentUnknown")
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!check.ok} onClick={() => check.ok && setConfirm(check.sizeGb)}>
              {t("common.next")}
            </Button>
          </>
        }
      >
        <Field
          label={t("appConfig.disks.resize.newSize")}
          hint={t("appConfig.disks.resize.growOnly")}
          error={size.length > 0 && !check.ok ? t(SIZE_ISSUE[check.issue]) : undefined}
        >
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="numeric"
              className="text-start font-mono"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}
