"use client";

import { Server, Database } from "lucide-react";
import { createElement, Suspense } from "react";
import { ServicePanelSlot } from "@/components/shell/service-panel-slot";
import { useShellStore } from "@/components/shell/shell-store";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPanel, listPanelTabs } from "@/lib/canvas/panel-registry";
import { parseServiceId } from "@/lib/canvas/service-id";
import { t } from "@/lib/i18n/t";
import "./panel-registrations";

function Placeholder({ kind, name }: { kind: "app" | "db"; name: string }) {
  const Icon = kind === "db" ? Database : Server;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon className="size-6" />
      </span>
      <p className="text-base font-semibold">
        <bdi dir="ltr">{name}</bdi>
      </p>
      <p className="text-sm text-muted">{kind === "db" ? t("canvasMap.panel.kindDb") : t("canvasMap.panel.kindApp")}</p>
      <h3 className="mt-2 text-base font-semibold">{t("canvasMap.panel.comingSoon")}</h3>
      <p className="max-w-xs text-sm leading-7 text-muted">{t("canvasMap.panel.comingSoonBody")}</p>
    </div>
  );
}

/**
 * Body of the service panel: a tab strip over whatever tabs the service units registered with `registerPanel`.
 * With nothing registered it shows the placeholder.
 */
function PanelBody({ service, tab, setTab }: { service: string; tab?: string; setTab: (tab: string) => void }) {
  const { kind, name } = parseServiceId(service);
  const tabs = listPanelTabs(kind);
  if (tabs.length === 0) return <Placeholder kind={kind} name={name} />;
  const active = tabs.find((x) => x.tab === tab)?.tab ?? tabs[0].tab;
  const panel = getPanel(kind, active);
  return (
    <Tabs value={active} onValueChange={setTab}>
      <TabsList aria-label={t("canvasMap.panel.tabs")} className="px-2">
        {tabs.map((x) => (
          <TabsTrigger key={x.tab} value={x.tab}>
            {x.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={active} className="p-4">
        {panel ? (
          <Suspense fallback={<Skeleton className="h-40" />}>
            {createElement(panel, { serviceId: service, name, kind, tab: active })}
          </Suspense>
        ) : (
          <Placeholder kind={kind} name={name} />
        )}
      </TabsContent>
    </Tabs>
  );
}

/** `servicePanel` for AppShell. Deep link `?service=&tab=` is handled by the shell's URL sync. */
export function CanvasServicePanel() {
  const service = useShellStore((s) => s.servicePanel.service);
  const title = service ? <bdi dir="ltr">{parseServiceId(service).name}</bdi> : undefined;
  return (
    <ServicePanelSlot title={title}>
      {({ service: id, tab, setTab }) => <PanelBody service={id} tab={tab} setTab={setTab} />}
    </ServicePanelSlot>
  );
}
