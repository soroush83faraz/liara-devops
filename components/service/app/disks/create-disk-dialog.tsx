"use client";

import { useState } from "react";
import { Button, Dialog, DialogContent, Field, Input } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { appPath, postJson } from "@/lib/service/app-config/client";
import { diskNameIssue, diskSizeCheck } from "@/lib/service/app-config/disks";
import { MAX_DISK_GB } from "@/lib/service/app-config/schemas";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";

const NAME_ISSUE = { empty: "appConfig.disks.nameIssue.empty", invalid: "appConfig.disks.nameIssue.invalid" } as const;
const SIZE_ISSUE = {
  empty: "appConfig.disks.sizeIssue.empty",
  not_integer: "appConfig.disks.sizeIssue.notInteger",
  range: "appConfig.disks.sizeIssue.range",
  not_larger: "appConfig.disks.sizeIssue.notLarger",
} as const;

/** Billed: step 1 collects name + size, step 2 is the typed-name confirmation with the cost note. */
export function CreateDiskDialog({ appName, onClose }: { appName: string; onClose: () => void }) {
  const done = useAfterMutation(appName);
  const [name, setName] = useState("");
  const [size, setSize] = useState("1");
  const [confirm, setConfirm] = useState<{ name: string; sizeGb: number } | null>(null);

  const nameIssue = diskNameIssue(name);
  const sizeCheck = diskSizeCheck(size);

  if (confirm) {
    return (
      <OpDialog
        open
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={t("appConfig.disks.create.title")}
        operation={t("appConfig.disks.create.operation", { size: confirm.sizeGb })}
        target={confirm.name}
        effect={t("appConfig.disks.create.effect", { app: appName })}
        risk={t("appConfig.disks.create.risk")}
        reversible="partly"
        cost={t("appConfig.disks.costNote")}
        typedName={confirm.name}
        confirmLabel={t("appConfig.disks.create.confirm")}
        onConfirm={async () => {
          await postJson(appPath(appName, "disks"), { name: confirm.name, sizeGb: confirm.sizeGb, typedName: confirm.name });
          done(t("appConfig.disks.create.toast"));
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        title={t("appConfig.disks.create.title")}
        description={t("appConfig.disks.costNote")}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={nameIssue !== null || !sizeCheck.ok}
              onClick={() => sizeCheck.ok && setConfirm({ name, sizeGb: sizeCheck.sizeGb })}
            >
              {t("common.next")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field
            label={t("appConfig.disks.nameLabel")}
            hint={t("appConfig.disks.nameHint")}
            error={name.length > 0 && nameIssue ? t(NAME_ISSUE[nameIssue]) : undefined}
          >
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                className="text-start font-mono"
                value={name}
                onChange={(e) => setName(e.target.value.trim())}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field
            label={t("appConfig.disks.sizeLabel")}
            hint={t("appConfig.disks.sizeHint", { max: MAX_DISK_GB })}
            error={size.length > 0 && !sizeCheck.ok ? t(SIZE_ISSUE[sizeCheck.issue]) : undefined}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
