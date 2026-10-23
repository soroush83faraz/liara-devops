"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fa } from "@/lib/i18n/fa";
import { relativeTime } from "@/lib/i18n/format";
import { splitHighlight, type Matcher } from "@/lib/service/app-read/highlight";
import type { LogLevel } from "@/lib/service/app-read/types";

export interface ViewerRow {
  key: string;
  /** ISO timestamp; omit for lines without one. */
  ts?: string;
  text: string;
  level?: LogLevel;
  stderr?: boolean;
  flagged?: boolean;
}

export type TimestampMode = "iso" | "relative";

/** «2025-10-06T12:00:01.123Z» -> «12:00:01» (UTC, like the ISO it abbreviates). Unparseable input is returned as is. */
export function compactTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toISOString().slice(11, 19);
}

const LEVEL_TEXT: Partial<Record<LogLevel, { tag: string; cls: string }>> = {
  error: { tag: "ERR", cls: "text-danger" },
  warn: { tag: "WRN", cls: "text-warn" },
  debug: { tag: "DBG", cls: "text-muted" },
};

function Highlighted({ text, matcher }: { text: string; matcher: Matcher }) {
  const segs = splitHighlight(text, matcher);
  return (
    <>
      {segs.map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-sm bg-warn-soft px-0.5 text-warn-ink">
            {s.text}
          </mark>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

/**
 * LTR monospace log block inside the RTL layout. Every line is rendered as React text (never HTML).
 * Auto-scroll is controlled: scrolling up by hand switches it off through `onAutoScrollChange`.
 */
export function LogViewer({
  rows,
  wrap,
  autoScroll,
  onAutoScrollChange,
  matcher,
  timestampMode = "iso",
  ariaLabel,
  empty,
  className,
}: {
  rows: ViewerRow[];
  wrap: boolean;
  autoScroll: boolean;
  onAutoScrollChange?: (on: boolean) => void;
  matcher: Matcher;
  timestampMode?: TimestampMode;
  ariaLabel: string;
  empty?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [rows, autoScroll]);

  return (
    <div
      ref={ref}
      dir="ltr"
      role="log"
      aria-live="off"
      aria-label={ariaLabel}
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        if (autoScroll && !nearBottom) onAutoScrollChange?.(false);
      }}
      className={cn(
        "@container h-[55vh] min-h-64 overflow-auto rounded-md border border-border bg-code-bg p-3 text-start font-mono text-[13px] leading-6 text-code-fg",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      {rows.length === 0 ? (
        <div dir="rtl" className="flex h-full items-center justify-center p-4 text-center font-sans text-sm text-muted">
          {empty}
        </div>
      ) : (
        <div className={cn(!wrap && "w-max min-w-full")}>
          {rows.map((r) => {
            const lv = r.level ? LEVEL_TEXT[r.level] : undefined;
            return (
              <div
                key={r.key}
                className={cn(
                  // Narrow viewer (phone, slim panel): the prefix (time, level) sits above the message so the
                  // message keeps the full width; from @lg up everything is one line.
                  "flex flex-col rounded-sm px-1 @lg:flex-row @lg:gap-2",
                  r.flagged && "bg-warn-soft text-warn-ink",
                  !r.flagged && r.level === "error" && "bg-danger-soft/40",
                )}
              >
                {r.ts || lv || r.flagged ? (
                  <span className="flex shrink-0 items-start gap-2">
                    {r.ts ? (
                      <span className="shrink-0 select-none text-muted" title={r.ts}>
                        {timestampMode === "iso" ? (
                          <>
                            <span className="@lg:hidden">{compactTime(r.ts)}</span>
                            <span className="hidden @lg:inline">{r.ts}</span>
                          </>
                        ) : (
                          <bdi dir="rtl" className="font-sans text-xs">
                            {relativeTime(r.ts)}
                          </bdi>
                        )}
                      </span>
                    ) : null}
                    {lv ? (
                      <span className={cn("w-7 shrink-0 select-none font-semibold", lv.cls)} aria-label={fa.appOps.logs.level[r.level as "error"]}>
                        {lv.tag}
                      </span>
                    ) : null}
                    {r.flagged ? (
                      <span className="shrink-0" title={fa.appOps.logs.flaggedHint}>
                        <TriangleAlert aria-label={fa.appOps.logs.flagged} className="mt-1 size-3.5" />
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span className={cn("min-w-0", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
                  <Highlighted text={r.text} matcher={matcher} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
