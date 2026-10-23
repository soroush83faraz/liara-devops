"use client";

import { rawStatusLabel } from "@/components/ui/status";
import { ArrowUpRight, Boxes, Cpu, HardDrive, MemoryStick, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  KeyValueList,
  Skeleton,
  Stat,
  StatGroup,
  StatusDot,
  normalizeStatus,
  type KeyValueItem,
  type ServiceStatus,
} from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { faDateTime, faNumber, faPrice, relativeTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { formatMemoryBytes } from "@/lib/service/app-read/format";
import { appletTone } from "@/lib/service/app-read/release-utils";
import type { AppOverviewDto, AppPanelProps, EventDto, Section } from "@/lib/service/app-read/types";
import { badgeToneFor, ReleaseStateBadge } from "./release-state-badge";
import { QueryErrorBanner, Unavailable } from "./unavailable";
import { useOverview } from "./use-app-queries";

const o = fa.appOps.overview;

function appStatus(app: AppOverviewDto["app"]): ServiceStatus {
  if (app.scale === 0) return "stopped";
  if (app.isDeployed === false) return "unknown";
  return normalizeStatus(app.status);
}

function SectionCard({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon ? <span aria-hidden className="text-muted [&>svg]:size-4">{icon}</span> : null}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function sectionData<T>(s: Section<T>): T | undefined {
  return s.unavailable ? undefined : s.data;
}

function Header({ data }: { data: AppOverviewDto }) {
  const status = appStatus(data.app);
  const rawStatus = data.app.status;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusDot status={status} />
        {status === "unknown" && rawStatus ? (
          <Badge>
            <bdi dir="ltr" className="font-mono">{rawStatus}</bdi>
          </Badge>
        ) : null}
        {data.app.scale === 0 ? <Badge tone="warn">{o.stopped}</Badge> : null}
      </div>
      {data.app.isDeployed === false ? <p className="text-xs leading-5 text-muted">{o.notDeployed}</p> : null}
    </div>
  );
}

function Facts({ data }: { data: AppOverviewDto }) {
  const { app } = data;
  const latest = sectionData(data.latestRelease);
  const lastDeployAt = latest?.finishedAt ?? latest?.createdAt;
  const items: KeyValueItem[] = [
    { key: o.platform, value: app.platform ?? fa.common.dash, ltr: Boolean(app.platform) },
    { key: o.plan, value: app.planID ?? fa.common.dash, ltr: Boolean(app.planID) },
    ...(app.bundlePlanID ? [{ key: o.bundle, value: app.bundlePlanID, ltr: true }] : []),
    ...(app.hourlyPrice !== undefined ? [{ key: o.price, value: t("appOps.overview.pricePerHour", { price: faPrice(app.hourlyPrice) }) }] : []),
    app.url
      ? { key: o.url, value: app.url, ltr: true, copy: app.url }
      : { key: o.url, value: <span className="text-muted">{o.noUrl}</span> },
    { key: o.network, value: app.network?.name ?? o.noNetwork, ltr: Boolean(app.network?.name) },
    ...(app.scale !== undefined ? [{ key: o.scale, value: faNumber(app.scale) }] : []),
    ...(app.nodeIp ? [{ key: o.nodeIp, value: app.nodeIp, ltr: true, copy: app.nodeIp }] : []),
    ...(app.zeroDowntime !== undefined ? [{ key: o.zeroDowntime, value: app.zeroDowntime ? o.on : o.off }] : []),
    ...(app.readOnlyRootFilesystem !== undefined ? [{ key: o.readOnlyFs, value: app.readOnlyRootFilesystem ? o.on : o.off }] : []),
    { key: o.created, value: app.createdAt ? faDateTime(app.createdAt) : fa.common.dash },
    {
      key: o.lastDeploy,
      value: data.latestRelease.unavailable ? (
        <Unavailable />
      ) : lastDeployAt ? (
        `${faDateTime(lastDeployAt)} (${relativeTime(lastDeployAt)})`
      ) : (
        o.noReleases
      ),
    },
  ];
  return <KeyValueList items={items} />;
}

function Applets({ section }: { section: AppOverviewDto["applets"] }) {
  if (section.unavailable) return <Unavailable hint />;
  if (!section.data.length) return <p className="text-sm text-muted">{o.appletsEmpty}</p>;
  return (
    <ul className="divide-y divide-border">
      {section.data.map((a, i) => (
        <li key={a.id ?? i} className="flex flex-col gap-1 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <bdi dir="ltr" className="font-mono text-sm">{a.name ?? a.id ?? `#${i + 1}`}</bdi>
            {a.state ? (
              <Badge tone={badgeToneFor(appletTone(a.state))}>
                {rawStatusLabel(a.state) ?? <bdi dir="ltr" className="font-mono">{a.state}</bdi>}
              </Badge>
            ) : null}
            {a.releaseTag ? (
              <span className="text-xs text-muted">
                {o.appletRelease}: <bdi dir="ltr" className="font-mono">{a.releaseTag}</bdi>
              </span>
            ) : null}
          </div>
          {a.reason ? (
            <p className="text-sm leading-7">
              <span className="text-muted">{o.appletReason}: </span>
              <bdi dir="ltr" className="font-mono text-[0.9em]">{a.reason}</bdi>
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Events({ section }: { section: AppOverviewDto["events"] }) {
  if (section.unavailable) return <Unavailable hint />;
  if (!section.data.length) return <p className="text-sm text-muted">{o.eventsEmpty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {section.data.map((e: EventDto, i) => (
        <li key={`${e.ts}-${i}`} className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{relativeTime(e.ts)}</span>
          <bdi dir="ltr" className="break-words font-mono text-[13px] leading-6">{e.message}</bdi>
        </li>
      ))}
    </ul>
  );
}

function Usage({ section }: { section: AppOverviewDto["usage"] }) {
  if (section.unavailable) return <Unavailable hint />;
  const { cpu, memory, disks } = section.data;
  const sum = (xs: Array<{ value: number }>) => xs.reduce((a, x) => a + x.value, 0);
  return (
    <div className="flex flex-col gap-3">
      <StatGroup className="sm:grid-cols-3 lg:grid-cols-3">
        <Stat
          icon={<Cpu />}
          label={o.cpu}
          value={cpu.length ? <bdi dir="ltr">{faNumber(sum(cpu), { maximumFractionDigits: 2 })}</bdi> : fa.common.dash}
          hint={cpu.length ? fa.appOps.metrics.cpuUnit : o.usageNone}
        />
        <Stat
          icon={<MemoryStick />}
          label={o.memory}
          value={memory.length ? <bdi dir="ltr">{formatMemoryBytes(sum(memory))}</bdi> : fa.common.dash}
          hint={memory.length ? undefined : o.usageNone}
        />
        <Stat
          icon={<HardDrive />}
          label={o.disk}
          value={disks.length ? faNumber(disks.length) : fa.common.dash}
          hint={disks.length ? disks.map((d) => d.name).filter(Boolean).join("، ") : o.usageNone}
        />
      </StatGroup>
      <p className="text-xs leading-6 text-muted">{fa.appOps.common.unitsUnverified}</p>
    </div>
  );
}

function LatestRelease({ section }: { section: AppOverviewDto["latestRelease"] }) {
  if (section.unavailable) return <Unavailable hint />;
  const r = section.data;
  if (!r) return <p className="text-sm text-muted">{o.noReleases}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <bdi dir="ltr" className="font-mono text-sm">{r.tag ?? r.id}</bdi>
        <ReleaseStateBadge state={r.state} />
        {r.createdAt ? <span className="text-xs text-muted">{relativeTime(r.createdAt)}</span> : null}
      </div>
      {r.failReason ? (
        <p className="rounded-sm border border-danger/40 bg-danger-soft p-3 text-sm leading-7 text-danger-ink">
          <bdi dir="ltr" className="font-mono">{r.failReason}</bdi>
        </p>
      ) : null}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-11 w-full rounded-md" />
      <div className="flex flex-col gap-3 rounded-md border border-border p-5">
        <Skeleton className="h-4 w-28" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-32 w-full rounded-md" />
    </div>
  );
}

export function AppOverviewTab({ name }: AppPanelProps) {
  const q = useOverview(name);
  if (q.isPending) return <OverviewSkeleton />;
  if (q.isError) return <QueryErrorBanner error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  const data = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Header data={data} />
      <SectionCard title={o.facts} icon={<Boxes />}>
        <Facts data={data} />
      </SectionCard>
      <SectionCard title={o.latestRelease} icon={<ArrowUpRight />}>
        <LatestRelease section={data.latestRelease} />
      </SectionCard>
      <SectionCard title={o.usage} icon={<Cpu />}>
        <Usage section={data.usage} />
      </SectionCard>
      <SectionCard title={o.applets} icon={<Boxes />}>
        <Applets section={data.applets} />
      </SectionCard>
      <SectionCard title={o.events} icon={<ScrollText />}>
        <Events section={data.events} />
      </SectionCard>
    </div>
  );
}
