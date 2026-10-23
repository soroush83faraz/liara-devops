import type { LogLevel, LogLineDto } from "./types";

export const LOG_CAP = 2000;

/** Keeps the newest `cap` items; reports how many were dropped. */
export function capTail<T>(items: T[], cap: number = LOG_CAP): { items: T[]; dropped: number } {
  return items.length > cap ? { items: items.slice(items.length - cap), dropped: items.length - cap } : { items, dropped: 0 };
}

export const lineKey = (l: Pick<LogLineDto, "tsNs" | "stream" | "message">): string => `${l.tsNs}|${l.stream}|${l.message}`;

export interface LineFilter {
  levels: ReadonlySet<LogLevel>; // empty = all
  matches: (message: string) => boolean;
}

export function filterLines(lines: LogLineDto[], f: LineFilter): LogLineDto[] {
  return lines.filter((l) => (f.levels.size === 0 || f.levels.has(l.level)) && f.matches(l.message));
}

/** Plain-text export of the last `n` lines: `ISO-timestamp [stream] message`. Latin digits, ISO timestamps. */
export function buildLogText(lines: LogLineDto[], n: number): string {
  return lines
    .slice(-Math.max(0, n))
    .map((l) => `${l.ts} [${l.stream}] ${l.message}`)
    .join("\n");
}

export function levelCounts(lines: LogLineDto[]): Record<LogLevel, number> {
  const c: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 };
  for (const l of lines) c[l.level]++;
  return c;
}
