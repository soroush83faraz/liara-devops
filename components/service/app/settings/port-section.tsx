"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { runOp } from "@/lib/client/ops";
import { t } from "@/lib/i18n/t";
import type { SettingsDto } from "@/lib/service/app-config/dto";
import { parsePort } from "@/lib/service/app-config/settings";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";
import { SettingsCard } from "./settings-card";

/** `update_port` (tier 1). The current port is shown only when Liara/releases told us. */
export function PortSection({ appName, settings }: { appName: string; settings: SettingsDto }) {
  const done = useAfterMutation(appName);
  const [value, setValue] = useState(settings.port !== undefined ? String(settings.port) : "");
  const [open, setOpen] = useState(false);
  const parsed = parsePort(value);
  const changed = parsed.ok && parsed.port !== settings.port;

  return (
    <SettingsCard id="port" title={t("appConfig.settings.port.title")} description={t("appConfig.settings.port.desc")}>
      <Field
        label={t("appConfig.settings.port.label")}
        hint={settings.port === undefined ? t("appConfig.settings.port.unknown") : t("appConfig.settings.port.current", { port: settings.port })}
        error={value.trim() !== "" && !parsed.ok ? t("appConfig.settings.port.invalid") : undefined}
      >
        {(p) => (
          <Input
            {...p}
            dir="ltr"
            inputMode="numeric"
            className="max-w-40 text-start font-mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />
        )}
      </Field>
      <Button className="self-start" disabled={!changed} onClick={() => setOpen(true)}>
        {t("common.save")}
      </Button>
      {open && parsed.ok ? (
        <OpDialog
          open
          onOpenChange={setOpen}
          title={t("appConfig.settings.port.dialogTitle")}
          operation={t("appConfig.settings.port.operation", { port: parsed.port })}
          target={appName}
          effect={t("appConfig.settings.port.effect")}
          risk={t("appConfig.settings.port.risk")}
          reversible="yes"
          confirmLabel={t("appConfig.settings.port.confirm")}
          onConfirm={async () => {
            await runOp({ params: { type: "update_port", app: appName, port: parsed.port } });
            done(t("appConfig.settings.port.toast"));
          }}
        />
      ) : null}
    </SettingsCard>
  );
}
