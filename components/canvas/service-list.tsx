"use client";

import { ChevronLeft, Network, Stethoscope } from "lucide-react";
import type { CSSProperties } from "react";
import { useShellStore } from "@/components/shell/shell-store";
import { Button } from "@/components/ui/button";
import { isFailing, useHealthStore } from "@/lib/canvas/health-store";
import type { Overview, OverviewService } from "@/lib/canvas/types";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import { ProbeBadge } from "./probe-badge";
import { needsAttention, ServiceMeta } from "./service-node";
import { SignalTile, StatusWord, signalOf } from "./service-signal";

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

/** Entrance stagger: 30 ms apart, capped at the 12th row. */
const enterDelay = (i: number): CSSProperties => ({ animationDelay: `${Math.min(i, 11) * 30}ms` });

function Row({ service, index }: { service: OverviewService; index: number }) {
  const health = useHealthStore((s) => s.byService[service.id]);
  const failing = isFailing(health);
  const bad = needsAttention(service, failing);
  const signal = signalOf(service.status, failing);
  const open = (tab?: string) => useShellStore.getState().openService(service.id, tab);
  return (
    <li
      style={enterDelay(index)}
      className={cn(
        "hl-enter rounded-md border bg-surface shadow-[var(--shadow-soft)] transition-[border-color,box-shadow] duration-200",
        bad
          ? "border-danger/70 shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_40%,transparent),0_10px_28px_-12px_color-mix(in_oklab,var(--danger)_45%,transparent)]"
          : "border-border hover:border-border-strong/60",
      )}
    >
      <button
        type="button"
        onClick={() => open()}
        aria-label={t("canvasMap.openService", { name: service.name })}
        className="group flex min-h-16 w-full items-center gap-3 rounded-md p-3 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <SignalTile kind={service.kind} platformOrEngine={service.platformOrEngine} signal={signal} />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[15px] font-bold leading-6">
              <bdi dir="ltr">{service.name}</bdi>
            </span>
            <span className="min-w-0 truncate text-xs text-muted">
              <ServiceMeta service={service} />
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusWord status={service.status} signal={signal} />
            <ProbeBadge health={health} kind={service.kind} />
          </span>
        </span>
        <ChevronLeft
          aria-hidden
          className="size-5 shrink-0 text-muted transition-transform duration-200 ease-out-expo group-hover:-translate-x-0.5 ltr:rotate-180 ltr:group-hover:translate-x-0.5"
        />
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
  let index = 0;
  return (
    <div aria-label={t("canvasMap.listLabel")} className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`net-${g.id}`} className="flex flex-col gap-2.5">
          <h3 id={`net-${g.id}`} className="flex items-center gap-2 px-1 text-xs font-medium text-muted">
            <Network aria-hidden className="size-3.5 text-accent" />
            {g.name === null ? (
              t("canvasMap.noNetwork")
            ) : (
              <span>
                {t("canvasMap.networkFrame")} <bdi dir="ltr" className="font-semibold text-foreground">{g.name}</bdi>
              </span>
            )}
            <span aria-hidden className="rounded-full bg-surface-muted px-1.5 text-[11px] leading-4 tabular-nums">
              {faNumber(g.services.length)}
            </span>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </h3>
          <ul className="flex flex-col gap-2">
            {g.services.map((s) => (
              <Row key={s.id} service={s} index={index++} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
