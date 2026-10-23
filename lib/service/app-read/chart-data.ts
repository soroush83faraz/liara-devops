// Client-safe chart helpers (no server imports).
export const MAX_POINTS_PER_SERIES = 300;

/** Evenly thins a series to at most `max` points (always keeps the first and the last). */
export function downsample<T>(points: T[], max: number = MAX_POINTS_PER_SERIES): T[] {
  if (points.length <= max || max < 2) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}

export interface MergedSeries {
  keys: Array<{ key: string; label: string }>;
  rows: Array<Record<string, number>>;
}

/** Merges per-applet series into chart rows `{t, s0, s1,…}` keyed by timestamp. */
export function mergeSeries(series: Array<{ applet?: string; points: Array<{ t: number; v: number }> }>): MergedSeries {
  const keys = series.map((s, i) => ({ key: `s${i}`, label: s.applet ?? `#${i + 1}` }));
  const byT = new Map<number, Record<string, number>>();
  series.forEach((s, i) => {
    for (const pt of s.points) {
      const row = byT.get(pt.t) ?? { t: pt.t };
      row[`s${i}`] = pt.v;
      byT.set(pt.t, row);
    }
  });
  return { keys, rows: [...byT.values()].sort((a, b) => a.t! - b.t!) };
}

export const BYTES_PER_MIB = 1024 * 1024;

/** Bytes -> MiB. The byte unit itself is an assumption until verified against a live account [VAL]. */
export const bytesToMiB = (bytes: number): number => bytes / BYTES_PER_MIB;
