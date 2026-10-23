"use client";

import { runOp } from "@/lib/client/ops";
import { t } from "@/lib/i18n/t";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";

/** Tier 1: removes one variable and restarts the app. */
export function EnvDeleteDialog({ appName, envKey, onClose }: { appName: string; envKey: string; onClose: () => void }) {
  const done = useAfterMutation(appName);
  return (
    <OpDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t("appConfig.vars.deleteTitle", { key: envKey })}
      operation={t("appConfig.vars.opDelete", { key: envKey })}
      target={appName}
      effect={t("appConfig.vars.effect")}
      risk={t("appConfig.vars.deleteRisk")}
      reversible="partly"
      danger
      confirmLabel={t("appConfig.vars.deleteConfirm")}
      onConfirm={async () => {
        await runOp({ params: { type: "unset_env", app: appName, keys: [envKey] } });
        done(t("appConfig.vars.deletedToast", { key: envKey }));
      }}
    />
  );
}
