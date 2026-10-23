"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyAwareDir } from "@/components/ui/dir";
import { CopyButton, EmptyState, ErrorBanner, Input, Skeleton, Switch } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { t } from "@/lib/i18n/t";
import { fetchJson } from "@/lib/service/app-read/client";
import { buildMatcher, matches } from "@/lib/service/app-read/highlight";
import { buildLineLevel, splitBuildLine } from "@/lib/service/app-read/build-log-text";
import { capTail } from "@/lib/service/app-read/log-text";
import type { ReleaseDto, ReleaseStreamEvent } from "@/lib/service/app-read/types";
import { useEventStream } from "@/lib/service/app-read/use-event-stream";
import { ConnectionBadge } from "../logs/connection-badge";
import { LogViewer, type ViewerRow } from "../logs/log-viewer";
import { ToggleChip } from "../logs/toggle-chip";
import { QueryErrorBanner } from "../overview/unavailable";

const r = fa.appOps.releases;
const l = fa.appOps.logs;
const BUILD_CAP = 3000;

interface BuildLine {
  stream: "STDOUT" | "STDERR";
  line: string;
  createdAt?: string;
}

interface Controls {
  wrap: boolean;
  autoScroll: boolean;
  query: string;
  useRegex: boolean;
}

function Toolbar({ c, set, copyText }: { c: Controls; set: (p: Partial<Controls>) => void; copyText: string }) {
  const matcher = buildMatcher(c.query, c.useRegex);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          dir={emptyAwareDir(c.query, "ltr")}
          aria-label={l.searchLabel}
          placeholder={l.searchPlaceholder}
          value={c.query}
          invalid={matcher?.ok === false}
          onChange={(e) => set({ query: e.target.value })}
          className="min-w-40 flex-1"
        />
        <ToggleChip pressed={c.useRegex} onClick={() => set({ useRegex: !c.useRegex })}>
          {l.regex}
        </ToggleChip>
        <CopyButton value={copyText} label={fa.common.copy} size="sm" />
      </div>
      {matcher?.ok === false ? <p className="text-sm text-danger">{l.regexInvalid}</p> : null}
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Switch label={l.wrap} checked={c.wrap} onCheckedChange={(wrap) => set({ wrap })} />
        <Switch label={l.autoScroll} checked={c.autoScroll} onCheckedChange={(autoScroll) => set({ autoScroll })} />
      </div>
    </div>
  );
}

function LinesView({ lines, c, set }: { lines: BuildLine[]; c: Controls; set: (p: Partial<Controls>) => void }) {
  const matcher = useMemo(() => buildMatcher(c.query, c.useRegex), [c.query, c.useRegex]);
  // The server already strips ANSI and splits entries; doing it here too covers live (SSE) events. Error/warn
  // lines (npm error, ERR!, Error: ...) get the viewer's level highlight whichever stream carried them.
  const shown = useMemo(() => lines.flatMap((x, i) => splitBuildLine(x.line).map((text, j) => ({ key: `${i}.${j}`, text, stderr: x.stream === "STDERR" }))), [lines]);
  const rows: ViewerRow[] = useMemo(
    () => shown.map((x) => ({ ...x, level: buildLineLevel(x.text) })).filter((row) => matches(row.text, matcher)),
    [shown, matcher],
  );
  const copyText = useMemo(() => shown.map((x) => x.text).join("\n"), [shown]);
  return (
    <div className="flex flex-col gap-3">
      <Toolbar c={c} set={set} copyText={copyText} />
      <LogViewer
        rows={rows}
        wrap={c.wrap}
        autoScroll={c.autoScroll}
        onAutoScrollChange={(autoScroll) => set({ autoScroll })}
        matcher={matcher}
        ariaLabel={r.buildLogs}
        empty={<span>{shown.length ? l.noMatch : r.buildLogsEmpty}</span>}
      />
    </div>
  );
}

function useControls() {
  const [c, setC] = useState<Controls>({ wrap: true, autoScroll: true, query: "", useRegex: false });
  const set = useCallback((p: Partial<Controls>) => setC((prev) => ({ ...prev, ...p })), []);
  return [c, set] as const;
}

/** Live build log over SSE. Lines are de-duplicated (the server replays from the start after a reconnect). */
function LiveBuildLog({ releaseId, appName }: { releaseId: string; appName: string }) {
  const qc = useQueryClient();
  const [c, set] = useControls();
  const [lines, setLines] = useState<BuildLine[]>([]);
  const [info, setInfo] = useState<{ queue?: number; state?: string; done?: { ok: boolean; reason?: string }; error?: string }>({});
  const pendingRef = useRef<BuildLine[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  // `app` lets the server scrub the app's own env values from the lines (a release does not carry its app name).
  const buildUrl = useCallback(() => `/api/releases/${encodeURIComponent(releaseId)}/stream?app=${encodeURIComponent(appName)}`, [releaseId, appName]);
  const onEvent = useCallback(
    (ev: ReleaseStreamEvent) => {
      if (ev.kind === "log") {
        const key = `${ev.createdAt ?? ""}|${ev.line}`;
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        pendingRef.current.push({ stream: ev.stream, line: ev.line, createdAt: ev.createdAt });
      } else if (ev.kind === "state") {
        setInfo((p) => ({ ...p, state: ev.state, queue: ev.queue }));
      } else if (ev.kind === "done") {
        setInfo((p) => ({ ...p, done: { ok: ev.ok, reason: ev.reason } }));
        void qc.invalidateQueries({ queryKey: ["release", releaseId] });
        void qc.invalidateQueries({ queryKey: ["app"] });
        return "stop";
      } else if (ev.kind === "error" && ev.fatal) {
        setInfo((p) => ({ ...p, error: ev.message }));
        return "stop";
      }
    },
    [qc, releaseId],
  );
  const { state, retry } = useEventStream<ReleaseStreamEvent>({ buildUrl, onEvent });

  useEffect(() => {
    const id = setInterval(() => {
      if (!pendingRef.current.length) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setLines((prev) => capTail([...prev, ...batch], BUILD_CAP).items);
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Flush what is left once the stream has ended, without waiting for the next tick.
  useEffect(() => {
    if (state === "ended" && pendingRef.current.length) {
      const batch = pendingRef.current;
      pendingRef.current = [];
      setLines((prev) => capTail([...prev, ...batch], BUILD_CAP).items);
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <ConnectionBadge state={state} />
        {info.queue ? <span className="text-sm text-muted">{t("appOps.releases.queue", { count: info.queue })}</span> : null}
        {info.done ? (
          <span className="text-sm" role="status">
            {info.done.reason === "watch_timeout" ? r.watchTimeout : info.done.ok ? r.doneOk : r.doneFail}
          </span>
        ) : null}
      </div>
      {info.error ? <ErrorBanner tone="warn" message={info.error} /> : null}
      {state === "failed" ? <ErrorBanner message={fa.appOps.conn.failed} onRetry={retry} retryLabel={fa.appOps.conn.reconnect} /> : null}
      <LinesView lines={lines} c={c} set={set} />
    </div>
  );
}

interface BuildLogsResponse {
  lines: BuildLine[];
  truncated: boolean;
  maxLines: number;
  partial?: boolean;
}

function StaticBuildLog({ releaseId, appName }: { releaseId: string; appName: string }) {
  const [c, set] = useControls();
  const q = useQuery({
    queryKey: ["release", releaseId, "build-logs", appName],
    queryFn: ({ signal }) => fetchJson<BuildLogsResponse>(`/api/releases/${encodeURIComponent(releaseId)}/build-logs?app=${encodeURIComponent(appName)}`, signal),
    staleTime: 60_000,
  });
  if (q.isPending) return <Skeleton aria-hidden className="h-64 w-full" />;
  if (q.isError) return <QueryErrorBanner error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  if (q.data.lines.length === 0) return <EmptyState title={r.buildLogsEmpty} />;
  return (
    <div className="flex flex-col gap-3">
      {q.data.truncated ? <p className="text-xs text-muted">{t("appOps.releases.buildLogsTruncated", { count: q.data.maxLines })}</p> : null}
      {q.data.partial ? <p className="text-xs text-warn-ink" role="status">{r.buildLogsPartial}</p> : null}
      <LinesView lines={q.data.lines} c={c} set={set} />
    </div>
  );
}

/** Live (SSE) while the release is building/deploying, a one-shot fetch otherwise. The mode is fixed per mount. */
export function BuildLogPanel({ release, appName }: { release: ReleaseDto; appName: string }) {
  const [live] = useState(release.live);
  return live ? <LiveBuildLog releaseId={release.id} appName={appName} /> : <StaticBuildLog releaseId={release.id} appName={appName} />;
}
