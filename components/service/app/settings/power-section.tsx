"use client";

import { Play, RotateCw, Square } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { runOp } from "@/lib/client/ops";
import { t } from "@/lib/i18n/t";
import type { SettingsDto } from "@/lib/service/app-config/dto";
import { powerState } from "@/lib/service/app-config/settings";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";
import { SettingsCard } from "./settings-card";

type Kind = "restart" | "stop" | "start";

/** Restart (`restart`), stop/start (`scale` 0/1): all tier 1. */
export function PowerSection({ appName, settings }: { appName: string; settings: SettingsDto }) {
  const done = useAfterMutation(appName);
  const [kind, setKind] = useState<Kind | null>(null);
  const state = powerState(settings);

  return (
    <SettingsCard id="power" title={t("appConfig.settings.power.title")} description={t("appConfig.settings.power.desc")}>
      <p className="flex items-center gap-2 text-sm">
        {t("appConfig.settings.power.state")}{" "}
        <Badge tone={state === "running" ? "ok" : state === "stopped" ? "warn" : "neutral"}>
          {t(`appConfig.settings.power.states.${state}`)}
        </Badge>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setKind("restart")} disabled={state === "stopped"}>
          <RotateCw aria-hidden className="size-4" />
          {t("appConfig.settings.power.restart")}
        </Button>
        <Button variant="secondary" onClick={() => setKind("stop")} disabled={state === "stopped"}>
          <Square aria-hidden className="size-4" />
          {t("appConfig.settings.power.stop")}
        </Button>
        <Button variant="secondary" onClick={() => setKind("start")} disabled={state === "running"}>
          <Play aria-hidden className="size-4" />
          {t("appConfig.settings.power.start")}
        </Button>
      </div>

      {kind ? (
        <OpDialog
          open
          onOpenChange={(o) => {
            if (!o) setKind(null);
          }}
          title={t(`appConfig.settings.power.${kind}Title`)}
          operation={t(`appConfig.settings.power.${kind}Op`)}
          target={appName}
          effect={t(`appConfig.settings.power.${kind}Effect`)}
          risk={t(`appConfig.settings.power.${kind}Risk`)}
          reversible="yes"
          confirmLabel={t(`appConfig.settings.power.${kind}Confirm`)}
          onConfirm={async () => {
            if (kind === "restart") await runOp({ params: { type: "restart", app: appName } });
            else await runOp({ params: { type: "scale", resource: { kind: "app", name: appName }, scale: kind === "start" ? 1 : 0 } });
            done(t(`appConfig.settings.power.${kind}Toast`));
          }}
        />
      ) : null}
    </SettingsCard>
  );
}
