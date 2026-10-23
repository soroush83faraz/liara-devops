import { latestUsage, type Applet, type AppDetail, type LogLine, type MetricsSummary, type ReleasesPage } from "../../liara";
import { toAppFacts, toAppletDto, toEventDto, toReleaseDto } from "./mappers";
import type { AppOverviewDto, Section, UsageDto } from "./types";

export type Part<T> = { ok: true; value: T } | { ok: false };

export const part = <T>(r: PromiseSettledResult<T>): Part<T> => (r.status === "fulfilled" ? { ok: true, value: r.value } : { ok: false });

const section = <T, U>(p: Part<T>, map: (v: T) => U): Section<U> => (p.ok ? { unavailable: false, data: map(p.value) } : { unavailable: true });

export function toUsage(s: MetricsSummary): UsageDto {
  const num = (v: string | undefined): number | undefined => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) ? n : undefined;
  };
  return {
    cpu: latestUsage(s.cpuUsage),
    memory: latestUsage(s.memoryUsage),
    disks: s.disksUsage.map((d) => ({
      ...(d.name ? { name: d.name } : {}),
      ...(num(d.size) !== undefined ? { size: num(d.size) } : {}),
      ...(num(d.usage) !== undefined ? { usage: num(d.usage) } : {}),
      ...(d.reportedAt ? { reportedAt: d.reportedAt } : {}),
    })),
  };
}

export interface OverviewParts {
  name: string;
  app: AppDetail;
  applets: Part<Applet[]>;
  releases: Part<ReleasesPage>;
  events: Part<LogLine[]>;
  usage: Part<MetricsSummary>;
  now?: number;
}

/** Pure assembly of the overview: each sub-call that failed becomes `{unavailable:true}`; the app itself is required. */
export function assembleOverview(p: OverviewParts): AppOverviewDto {
  return {
    app: toAppFacts(p.app, p.name),
    applets: section(p.applets, (list) => list.map(toAppletDto)),
    latestRelease: section(p.releases, (page) => {
      const first = page.releases[0];
      return first ? toReleaseDto(first, { currentReleaseId: page.currentRelease, now: p.now }) : null;
    }),
    events: section(p.events, (lines) => lines.slice(-5).reverse().map(toEventDto)),
    usage: section(p.usage, toUsage),
  };
}
