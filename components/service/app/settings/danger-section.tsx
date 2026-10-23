"use client";

import { Trash2, TriangleAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import { useShellStore } from "@/components/shell/shell-store";
import { runOp } from "@/lib/client/ops";
import { t } from "@/lib/i18n/t";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { SettingsCard } from "./settings-card";

/** `delete_app` (tier 3, human-only): typed name + a red warning about what is lost for good. */
export function DangerSection({ appName }: { appName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  return (
    <SettingsCard id="danger" tone="danger" title={t("appConfig.settings.danger.title")} description={t("appConfig.settings.danger.desc")}>
      <Button variant="danger" className="self-start" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden className="size-4" />
        {t("appConfig.settings.danger.delete")}
      </Button>
      {open ? (
        <OpDialog
          open
          onOpenChange={setOpen}
          title={t("appConfig.settings.danger.dialogTitle")}
          operation={t("appConfig.settings.danger.operation")}
          target={appName}
          effect={t("appConfig.settings.danger.effect")}
          risk={t("appConfig.settings.danger.risk")}
          reversible="no"
          typedName={appName}
          danger
          confirmLabel={t("appConfig.settings.danger.confirm")}
          onConfirm={async () => {
            await runOp({ params: { type: "delete_app", app: appName }, typedName: appName });
            toast({ title: t("appConfig.settings.danger.toast"), variant: "success" });
            void qc.invalidateQueries({ queryKey: ["overview"] });
            useShellStore.getState().closeService();
          }}
        >
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/60 bg-danger-soft p-3 text-sm font-medium leading-7 text-danger-ink">
            <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
            {t("appConfig.settings.danger.warning")}
          </p>
        </OpDialog>
      ) : null}
    </SettingsCard>
  );
}
