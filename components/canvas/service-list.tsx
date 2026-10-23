"use client";

import { ChevronLeft, Network, Stethoscope } from "lucide-react";
import { useShellStore } from "@/components/shell/shell-store";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { isFailing, useHealthStore } from "@/lib/canvas/health-store";
import type { Overview, OverviewService } from "@/lib/canvas/types";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import { ProbeBadge } from "./probe-badge";
import { needsAttention } from "./service-node";
import { ServiceIcon } from "./service-icon";

export function groupByNetwork(overview: Pick<Overview, "networks" | "services">) {
  const known = new Set(overview.networks.map((n) => n.id));
  const groups = overview.networks.map((n) => ({ id: n.id, name: n.name as string | null, services: [] as OverviewService[] }));
  const none = { id: "none", name: null as string | null, services: [] as OverviewService[] };
  for (const s of overview.services) {
    const g = s.networkId && known.has(s.networkId) ? groups.find((x) => x.id === s.networkId) : undefined;
    (g ?? none).services.push(s);
  }
  return [...groups, none].filter((g) => g.services.length > 0);
}

function Row({ service }: { service: OverviewService }) {
  const health = useHealthStore((s) => s.byService[service.id]);
  const bad = needsAttention(service, isFailing(health));
  const open = (tab?: string) => useShellStore.getState().openService(service.id, tab);
  return (
    <li className={cn("rounded-xl border bg-surface", bad ? "border-danger ring-1 ring-danger/40" : "border-border")}>
      <button
        type="button"
        onClick={() => open()}
        aria-label={t("canvasMap.openService", { name: service.name })}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl p-3 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ServiceIcon kind={service.kind} platformOrEngine={service.platformOrEngine} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold leading-7">
            <bdi dir="ltr">{service.name}</bdi>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusDot status={service.status} />
            <ProbeBadge health={health} kind={service.kind} />
          </span>
        </span>
        <ChevronLeft aria-hidden className="size-5 shrink-0 text-muted rtl:rotate-0 ltr:rotate-180" />
      </button>
      {bad ? (
        <div className="px-3 pb-3">
          <Button variant="danger" size="sm" fullWidth onClick={() => open("copilot")} aria-label={t("canvasMap.investigateLabel", { name: service.name })}>
            <Stethoscope aria-hidden className="size-4" />
            {t("canvasMap.investigate")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Mobile / accessible alternative to the canvas: the same services grouped by private network. */
export function ServiceList({ overview }: { overview: Overview }) {
  const groups = groupByNetwork(overview);
  return (
    <div aria-label={t("canvasMap.listLabel")} className="flex flex-col gap-5 p-4">
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`net-${g.id}`} className="flex flex-col gap-2">
          <h3 id={`net-${g.id}`} className="flex items-center gap-2 text-sm font-semibold text-muted">
            <Network aria-hidden className="size-4" />
            {g.name === null ? (
              t("canvasMap.noNetwork")
            ) : (
              <>
                {t("canvasMap.networkFrame")} <bdi dir="ltr">{g.name}</bdi>
              </>
            )}
          </h3>
          <ul className="flex flex-col gap-2">
            {g.services.map((s) => (
              <Row key={s.id} service={s} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
