"use client";

import { useState } from "react";
import { Badge, Button, Switch } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { appPath, postJson } from "@/lib/service/app-config/client";
import type { AppToggleId, SettingsDto } from "@/lib/service/app-config/dto";
import { TOGGLES, toggleState } from "@/lib/service/app-config/settings";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";
import { SettingsCard } from "./settings-card";

const KEYS = {
  "zero-downtime": {
    title: "appConfig.settings.toggles.zeroDowntime.title",
    desc: "appConfig.settings.toggles.zeroDowntime.desc",
    risk: "appConfig.settings.toggles.zeroDowntime.risk",
  },
  "default-subdomain": {
    title: "appConfig.settings.toggles.defaultSubdomain.title",
    desc: "appConfig.settings.toggles.defaultSubdomain.desc",
    risk: "appConfig.settings.toggles.defaultSubdomain.risk",
  },
  "fixed-ip": {
    title: "appConfig.settings.toggles.fixedIp.title",
    desc: "appConfig.settings.toggles.fixedIp.desc",
    risk: "appConfig.settings.toggles.fixedIp.risk",
  },
  "read-only": {
    title: "appConfig.settings.toggles.readOnly.title",
    desc: "appConfig.settings.toggles.readOnly.desc",
    risk: "appConfig.settings.toggles.readOnly.risk",
  },
} as const satisfies Record<AppToggleId, { title: string; desc: string; risk: string }>;

/** Zero-downtime, default subdomain, fixed IP, read-only FS. A switch never flips by itself: it opens the confirmation. */
export function TogglesSection({ appName, settings }: { appName: string; settings: SettingsDto }) {
  const done = useAfterMutation(appName);
  const [pending, setPending] = useState<{ id: AppToggleId; enabled: boolean } | null>(null);

  return (
    <SettingsCard id="toggles" title={t("appConfig.settings.toggles.title")} description={t("appConfig.settings.toggles.desc")}>
      <ul className="flex flex-col divide-y divide-border">
        {TOGGLES.map((m) => {
          const state = toggleState(m.id, settings);
          const k = KEYS[m.id];
          return (
            <li key={m.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              {state === undefined ? (
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-[15px] font-medium">{t(k.title)}</p>
                    <p className="text-xs leading-6 text-muted">{t(k.desc)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{t("appConfig.settings.toggles.unknownState")}</Badge>
                    {settings.fixedIPStatus && m.id === "fixed-ip" ? (
                      <bdi dir="ltr" className="font-mono text-xs text-muted">
                        {settings.fixedIPStatus}
                      </bdi>
                    ) : null}
                    <Button variant="secondary" size="sm" onClick={() => setPending({ id: m.id, enabled: true })}>
                      {t("appConfig.settings.toggles.enable")}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setPending({ id: m.id, enabled: false })}>
                      {t("appConfig.settings.toggles.disable")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Switch
                  label={t(k.title)}
                  description={t(k.desc)}
                  checked={state}
                  onCheckedChange={(next) => setPending({ id: m.id, enabled: next })}
                />
              )}
              {m.id === "fixed-ip" && settings.nodeIp ? (
                <p className="text-xs text-muted">
                  {t("appConfig.settings.toggles.nodeIp")}{" "}
                  <bdi dir="ltr" className="font-mono">
                    {settings.nodeIp}
                  </bdi>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {pending ? (
        <OpDialog
          open
          onOpenChange={(o) => {
            if (!o) setPending(null);
          }}
          title={t(pending.enabled ? "appConfig.settings.toggles.enableTitle" : "appConfig.settings.toggles.disableTitle", {
            name: t(KEYS[pending.id].title),
          })}
          operation={t(pending.enabled ? "appConfig.settings.toggles.enableOp" : "appConfig.settings.toggles.disableOp", {
            name: t(KEYS[pending.id].title),
          })}
          target={appName}
          effect={t(KEYS[pending.id].desc)}
          risk={t(KEYS[pending.id].risk)}
          reversible="yes"
          typedName={TOGGLES.find((m) => m.id === pending.id)?.typed ? appName : undefined}
          confirmLabel={t(pending.enabled ? "appConfig.settings.toggles.enable" : "appConfig.settings.toggles.disable")}
          onConfirm={async () => {
            await postJson(`${appPath(appName, "settings")}/toggle`, {
              toggle: pending.id,
              enabled: pending.enabled,
              ...(TOGGLES.find((m) => m.id === pending.id)?.typed ? { typedName: appName } : {}),
            });
            done(t("appConfig.settings.toggles.toast"));
          }}
        />
      ) : null}
    </SettingsCard>
  );
}
