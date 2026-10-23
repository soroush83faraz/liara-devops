"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { Boxes, Database, Globe, TriangleAlert } from "lucide-react";
import { Badge, Button, KeyValueList, Skeleton, StatusDot, type KeyValueItem } from "@/components/ui";
import { useShellStore } from "@/components/shell/shell-store";
import { fa } from "@/lib/i18n/fa";
import { faDateTime, faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { Overview } from "@/lib/canvas/types";
import { engineMeta } from "@/lib/service/db/engines";
import { hourlyPriceText, monthlyPriceText } from "@/lib/service/db/format";
import { ConnectionCard } from "./connection-card";
import { QueryError, SectionCard, type DbPanelProps } from "./shared";
import { useDbOverview } from "./use-db";

/** Canvas overview already in the query cache (never fetched here, never contains env values). */
function useRelatedApps(serviceId: string) {
  const q = useQuery<Overview>({ queryKey: ["overview"], queryFn: skipToken });
  if (!q.data) return undefined;
  const names = new Map(q.data.services.map((s) => [s.id, s.name]));
  return q.data.edges.filter((e) => e.to === serviceId).map((e) => ({ id: e.from, name: names.get(e.from) ?? e.from, viaKey: e.viaKey }));
}

function RelatedApps({ serviceId }: { serviceId: string }) {
  const apps = useRelatedApps(serviceId);
  const via = fa.dbPanel.overview.viaVariable.split("{name}");
  if (apps === undefined) return null; // canvas data not loaded: omit rather than fetch env values
  return (
    <SectionCard title={t("dbPanel.overview.usedBy")} icon={<Boxes />} description={t("dbPanel.overview.usedByHint")}>
      {apps.length === 0 ? (
        <p className="text-sm text-muted">{t("dbPanel.overview.usedByEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {apps.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <bdi dir="ltr" className="font-mono text-sm">{a.name}</bdi>
              <span className="text-xs text-muted">
                {via[0]}
                <bdi dir="ltr" className="font-mono">{a.viaKey}</bdi>
                {via[1]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function DbOverviewTab({ name, serviceId }: DbPanelProps & { serviceId: string }) {
  const q = useDbOverview(name);
  const setTab = useShellStore((s) => s.setTab);

  if (q.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;

  const d = q.data;
  const eng = engineMeta(d.engine);
  const EngineIcon = eng.icon;
  const items: KeyValueItem[] = [
    {
      key: t("dbPanel.overview.engine"),
      value: (
        <span className="inline-flex items-center gap-2">
          <EngineIcon aria-hidden className="size-4 text-muted" />
          <bdi dir="ltr">{eng.label}</bdi>
        </span>
      ),
    },
    { key: t("dbPanel.overview.version"), value: d.version ?? fa.common.dash, ltr: Boolean(d.version) },
    { key: t("dbPanel.overview.plan"), value: d.planID ?? fa.common.dash, ltr: Boolean(d.planID) },
    ...(d.hourlyPrice !== undefined
      ? [{ key: t("dbPanel.overview.price"), value: t("dbPanel.common.priceBoth", { hourly: hourlyPriceText(d.hourlyPrice), monthly: monthlyPriceText(d.hourlyPrice) }) }]
      : []),
    ...(d.volumeSizeGb !== undefined ? [{ key: t("dbPanel.overview.volume"), value: t("dbPanel.overview.volumeValue", { size: d.volumeSizeGb }) }] : []),
    { key: t("dbPanel.overview.network"), value: d.network?.name ?? t("dbPanel.overview.noNetwork"), ltr: Boolean(d.network?.name) },
    { key: t("dbPanel.overview.publicNetwork"), value: d.publicNetwork ? t("dbPanel.common.on") : t("dbPanel.common.off") },
    ...(d.scale !== undefined ? [{ key: t("dbPanel.overview.scale"), value: faNumber(d.scale) }] : []),
    ...(d.standaloneReplicaSet !== undefined
      ? [{ key: t("dbPanel.overview.replicaSet"), value: d.standaloneReplicaSet ? t("dbPanel.common.on") : t("dbPanel.common.off") }]
      : []),
    { key: t("dbPanel.overview.created"), value: d.createdAt ? faDateTime(d.createdAt) : fa.common.dash },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusDot status={d.uiStatus} className="text-base" />
        {d.uiStatus === "unknown" && d.status ? (
          <Badge>
            <bdi dir="ltr" className="font-mono">{d.status}</bdi>
          </Badge>
        ) : null}
      </div>
      {d.uiStatus === "stopped" ? <p className="text-sm leading-7 text-muted">{t("dbPanel.overview.stoppedNote")}</p> : null}

      {d.publicNetwork ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn-soft p-4 text-warn-ink sm:flex-row sm:items-start">
          <TriangleAlert aria-hidden className="mt-1 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-8">{t("dbPanel.overview.publicWarningTitle")}</p>
            <p className="text-sm leading-7">{t("dbPanel.overview.publicWarningBody")}</p>
          </div>
          <Button variant="secondary" size="sm" className="shrink-0 self-start" onClick={() => setTab("settings")}>
            <Globe aria-hidden className="size-4" />
            {t("dbPanel.overview.publicWarningCta")}
          </Button>
        </div>
      ) : null}

      <SectionCard title={t("dbPanel.overview.facts")} icon={<Database />}>
        <KeyValueList items={items} />
      </SectionCard>

      <ConnectionCard host={name} />
      <RelatedApps serviceId={serviceId} />
    </div>
  );
}
