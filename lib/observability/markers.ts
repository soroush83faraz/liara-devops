// Deployment markers: release timestamps mapped onto a chart's time axis (unix seconds). Pure and client-safe.
import { faTime } from "@/lib/i18n/format";
import type { ObsRelease } from "./types";

export interface ChartMarker {
  id: string;
  /** Unix seconds (same axis as the chart rows). */
  t: number;
  /** Release time as shown on the chart, e.g. «۱۴:۳۰». */
  label: string;
  /** False when another labelled marker is too close: the dashed line stays, the text is skipped to avoid overlap. */
  showLabel: boolean;
}

export interface TimeDomain {
  from: number;
  to: number;
}

/** A label needs roughly this share of the axis; closer markers keep their line but lose the text. */
const MIN_LABEL_GAP = 0.1;

/** Domain of chart rows (`t` in unix seconds), or null when there are none. */
export function domainOf(rows: ReadonlyArray<{ t?: number }>): TimeDomain | null {
  let from = Infinity;
  let to = -Infinity;
  for (const r of rows) {
    if (typeof r.t !== "number" || !Number.isFinite(r.t)) continue;
    if (r.t < from) from = r.t;
    if (r.t > to) to = r.t;
  }
  return from <= to ? { from, to } : null;
}

/**
 * Releases inside `domain` (inclusive), oldest first, one per distinct second. Unparsable timestamps and releases
 * outside the window are dropped (never clamped onto the edge: that would claim a time we do not know).
 */
export function releaseMarkers(
  releases: readonly ObsRelease[] | undefined,
  domain: TimeDomain | null,
  format: (iso: string) => string = faTime,
): ChartMarker[] {
  if (!releases?.length || !domain) return [];
  const seen = new Set<number>();
  const inside: ChartMarker[] = [];
  for (const r of releases) {
    const ms = Date.parse(r.at);
    if (Number.isNaN(ms)) continue;
    const t = Math.floor(ms / 1000);
    if (t < domain.from || t > domain.to || seen.has(t)) continue;
    seen.add(t);
    inside.push({ id: r.id, t, label: format(r.at), showLabel: false });
  }
  inside.sort((a, b) => a.t - b.t);
  const span = Math.max(1, domain.to - domain.from);
  let lastLabelled = -Infinity;
  for (const m of inside) {
    if (m.t - lastLabelled >= span * MIN_LABEL_GAP) {
      m.showLabel = true;
      lastLabelled = m.t;
    }
  }
  return inside;
}

/** Markers for a chart drawn from `series` (points in unix seconds): only releases inside the data's time range. */
export function markersForSeries(
  releases: readonly ObsRelease[] | undefined,
  series: ReadonlyArray<{ points: ReadonlyArray<{ t: number }> }>,
  format?: (iso: string) => string,
): ChartMarker[] {
  return releaseMarkers(releases, domainOf(series.flatMap((s) => s.points)), format);
}

/** "none" only when the releases lookup succeeded and returned nothing; a failed lookup is "unknown", never "none". */
export function lastReleaseState(s: { lastReleaseAt?: string; releasesUnavailable?: boolean }): "known" | "none" | "unknown" {
  if (s.lastReleaseAt) return "known";
  return s.releasesUnavailable ? "unknown" : "none";
}
