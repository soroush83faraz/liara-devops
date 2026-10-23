"use client";

import { Server, Database } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { createElement, Suspense } from "react";
import { ServicePanelSlot } from "@/components/shell/service-panel-slot";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isFailing, useHealthStore } from "@/lib/canvas/health-store";
import { getPanel, listPanelTabs } from "@/lib/canvas/panel-registry";
import { parseServiceId } from "@/lib/canvas/service-id";
import type { OverviewService } from "@/lib/canvas/types";
import { useOverview } from "@/lib/canvas/use-overview";
import { t } from "@/lib/i18n/t";
import { spring } from "@/lib/ui/motion";
import { SignalTile, StatusWord, signalOf } from "./service-signal";
import { ServiceMeta } from "./service-node";
import "./panel-registrations";

function Placeholder({ kind, name }: { kind: "app" | "db"; name: string }) {
  const Icon = kind === "db" ? Database : Server;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-md border border-border bg-surface-muted text-accent">
        <Icon className="size-6" />
      </span>
      <p className="text-base font-semibold">
        <bdi dir="ltr">{name}</bdi>
      </p>
      <p className="text-sm text-muted">{kind === "db" ? t("canvasMap.panel.kindDb") : t("canvasMap.panel.kindApp")}</p>
      <h3 className="mt-2 text-base font-semibold">{t("canvasMap.panel.comingSoon")}</h3>
      <p className="max-w-xs text-sm leading-6 text-muted">{t("canvasMap.panel.comingSoonBody")}</p>
    </div>
  );
}

const DEFAULT_TAB = "overview";

/** Generic tab body placeholder while a lazily loaded tab arrives. */
function TabFallback() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <Skeleton className="h-24 rounded-md" />
      <SkeletonText lines={4} />
    </div>
  );
}

/**
 * Body of the service panel: a tab strip over whatever tabs the service units registered with `registerPanel`.
 * With nothing registered it shows the placeholder. The strip scrolls sideways and stays pinned (see TabsList); the
 * selected tab's underline is one shared-layout element that glides between tabs.
 */
function PanelBody({ service, tab, setTab }: { service: string; tab?: string; setTab: (tab: string) => void }) {
  const { kind, name } = parseServiceId(service);
  const tabs = listPanelTabs(kind);
  if (tabs.length === 0) return <Placeholder kind={kind} name={name} />;
  // No `?tab=`: land on the overview (what the service is and how it is doing); the copilot tab is one click away and
  // every "investigate" entry point (node stethoscope, health alert, command palette) asks for it explicitly.
  const fallback = tabs.find((x) => x.tab === DEFAULT_TAB)?.tab ?? tabs[0].tab;
  const active = tabs.find((x) => x.tab === tab)?.tab ?? fallback;
  const panel = getPanel(kind, active);
  return (
    <Tabs value={active} onValueChange={setTab}>
      <LayoutGroup id={`service-tabs-${service}`}>
        {/* Tight tab padding so the nine app tabs fit the default 560 px drawer; narrower panels scroll (with edge fades). */}
        <TabsList aria-label={t("canvasMap.panel.tabs")} indicator="none" className="gap-0 px-1.5">
          {tabs.map((x) => (
            <TabsTrigger key={x.tab} value={x.tab} className="px-2.5">
              {x.label}
              {x.tab === active ? (
                <motion.span
                  aria-hidden
                  layoutId="service-tab-underline"
                  transition={spring.pop}
                  className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-accent"
                />
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </LayoutGroup>
      <TabsContent value={active} className="px-4 pb-8 pt-4">
        {panel ? (
          <Suspense fallback={<TabFallback />}>
            {createElement(panel, { serviceId: service, name, kind, tab: active })}
          </Suspense>
        ) : (
          <Placeholder kind={kind} name={name} />
        )}
      </TabsContent>
    </Tabs>
  );
}

function useServiceRecord(id: string): OverviewService | undefined {
  const { data } = useOverview();
  return data?.services.find((s) => s.id === id);
}

function HeaderTile({ id }: { id: string }) {
  const service = useServiceRecord(id);
  const failing = useHealthStore((s) => isFailing(s.byService[id]));
  const { kind } = parseServiceId(id);
  return (
    <SignalTile
      kind={kind}
      platformOrEngine={service?.platformOrEngine ?? ""}
      signal={service ? signalOf(service.status, failing) : "unknown"}
      size="lg"
    />
  );
}

function HeaderLine({ id }: { id: string }) {
  const service = useServiceRecord(id);
  const failing = useHealthStore((s) => isFailing(s.byService[id]));
  const { kind } = parseServiceId(id);
  const kindLabel = kind === "db" ? t("canvasMap.panel.kindDb") : t("canvasMap.panel.kindApp");
  if (!service) return <>{kindLabel}</>;
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <StatusWord status={service.status} signal={signalOf(service.status, failing)} className="shrink-0" />
      <span aria-hidden className="text-border-strong">
        ·
      </span>
      <span className="truncate">
        <ServiceMeta service={service} showKind />
      </span>
    </span>
  );
}

/** `servicePanel` for AppShell. Deep link `?service=&tab=` is handled by the shell's URL sync. */
export function CanvasServicePanel() {
  return (
    <ServicePanelSlot
      title={(id) => <bdi dir="ltr">{parseServiceId(id).name}</bdi>}
      subtitle={(id) => <HeaderLine id={id} />}
      leading={(id) => <HeaderTile id={id} />}
    >
      {({ service: id, tab, setTab }) => <PanelBody service={id} tab={tab} setTab={setTab} />}
    </ServicePanelSlot>
  );
}
