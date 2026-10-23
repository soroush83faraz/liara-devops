"use client";

import { t } from "@/lib/i18n/t";
import { useSettings } from "@/lib/service/app-config/client";
import { ListSkeleton, LoadError } from "@/lib/service/app-config/ui/load-state";
import type { AppPanelProps } from "@/lib/service/app-read/types";
import { DangerSection } from "./danger-section";
import { PlanSection } from "./plan-section";
import { PortSection } from "./port-section";
import { PowerSection } from "./power-section";
import { TogglesSection } from "./toggles-section";

/** Port, plan, toggles, power and the danger zone. Every change goes through a confirmation dialog. */
export function SettingsTab({ name }: AppPanelProps) {
  const q = useSettings(name);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("appConfig.settings.title")}</h2>
      {q.isPending ? <ListSkeleton rows={3} /> : null}
      {q.isError ? <LoadError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}
      {q.data ? (
        <>
          <PortSection appName={name} settings={q.data} />
          <PlanSection appName={name} settings={q.data} />
          <TogglesSection appName={name} settings={q.data} />
          <PowerSection appName={name} settings={q.data} />
          <DangerSection appName={name} />
        </>
      ) : null}
    </div>
  );
}
