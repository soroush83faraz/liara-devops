"use client";

import { Download, Eraser, Pause, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, EmptyState, ErrorBanner, Input, Select, Switch } from "@/components/ui";
import { emptyAwareDir } from "@/components/ui/dir";
import { fa } from "@/lib/i18n/fa";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { buildMatcher, matches } from "@/lib/service/app-read/highlight";
import { buildLogText, filterLines, levelCounts } from "@/lib/service/app-read/log-text";
import { LOG_LEVELS, type AppPanelProps, type LogLevel } from "@/lib/service/app-read/types";
import { useReleasesPage } from "../overview/use-app-queries";
import { ConnectionBadge } from "./connection-badge";
import { isSuspiciousLine } from "./suspicious";
import { LogViewer, type TimestampMode, type ViewerRow } from "./log-viewer";
import { ToggleChip } from "./toggle-chip";
import { useLogStream } from "./use-log-stream";

const l = fa.appOps.logs;
const ALL = "all";
const DOWNLOAD_COUNTS = [100, 500, 2000] as const;

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LiveLogs({ name, releaseId, sinceIso }: { name: string; releaseId?: string; sinceIso?: string }) {
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [tsMode, setTsMode] = useState<TimestampMode>("iso");
  const [levels, setLevels] = useState<ReadonlySet<LogLevel>>(new Set());
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [dlCount, setDlCount] = useState<string>("500");

  const stream = useLogStream({ name, releaseId, sinceIso, paused });
  const matcher = useMemo(() => buildMatcher(query, useRegex), [query, useRegex]);
  const counts = useMemo(() => levelCounts(stream.lines), [stream.lines]);
  const visible = useMemo(
    () => filterLines(stream.lines, { levels, matches: (m) => matches(m, matcher) }),
    [stream.lines, levels, matcher],
  );
  const rows: ViewerRow[] = useMemo(
    () =>
      visible.map((x, i) => ({
        key: `${x.tsNs}-${i}`,
        ts: x.tsNs === "0" ? undefined : x.ts,
        text: x.message,
        level: x.level,
        stderr: x.stream === "stderr",
        flagged: isSuspiciousLine(x),
      })),
    [visible],
  );

  const toggleLevel = (lv: LogLevel) =>
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });

  const onDownload = () => {
    const n = Number(dlCount);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadText(`${name}-logs-${stamp}.txt`, buildLogText(visible, n));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ConnectionBadge state={stream.state} paused={paused} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
            {paused ? l.resume : l.pause}
          </Button>
          <Button variant="ghost" size="sm" onClick={stream.clear}>
            <Eraser aria-hidden className="size-4" />
            {l.clear}
          </Button>
        </div>
      </div>

      {stream.fatal ? (
        <ErrorBanner tone="warn" message={stream.fatal} onRetry={stream.retry} retryLabel={fa.appOps.conn.reconnect} />
      ) : stream.state === "failed" ? (
        <ErrorBanner message={fa.appOps.conn.failed} onRetry={stream.retry} retryLabel={fa.appOps.conn.reconnect} />
      ) : null}

      <div role="group" aria-label={l.levels} className="flex flex-wrap gap-2">
        {LOG_LEVELS.map((lv) => (
          <ToggleChip key={lv} pressed={levels.has(lv)} onClick={() => toggleLevel(lv)}>
            {l.level[lv]}
            <span className="text-xs tabular-nums text-muted">{faNumber(counts[lv])}</span>
          </ToggleChip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          dir={emptyAwareDir(query, "ltr")}
          aria-label={l.searchLabel}
          placeholder={l.searchPlaceholder}
          value={query}
          invalid={matcher?.ok === false}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-40 flex-1"
        />
        <ToggleChip pressed={useRegex} onClick={() => setUseRegex((r) => !r)}>
          {l.regex}
        </ToggleChip>
      </div>
      {matcher?.ok === false ? <p className="text-sm text-danger">{l.regexInvalid}</p> : null}

      <div className="grid gap-x-6 sm:grid-cols-3">
        <Switch label={l.wrap} checked={wrap} onCheckedChange={setWrap} />
        <Switch label={l.autoScroll} checked={autoScroll} onCheckedChange={setAutoScroll} />
        <Switch
          label={l.timestampRelative}
          description={l.timestampToggle}
          checked={tsMode === "relative"}
          onCheckedChange={(on) => setTsMode(on ? "relative" : "iso")}
        />
      </div>

      <LogViewer
        rows={rows}
        wrap={wrap}
        autoScroll={autoScroll}
        onAutoScrollChange={setAutoScroll}
        matcher={matcher}
        timestampMode={tsMode}
        ariaLabel={l.viewerLabel}
        empty={
          stream.lines.length === 0 ? (
            <EmptyState title={l.empty} description={l.emptyHint} />
          ) : (
            <span>{l.noMatch}</span>
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span aria-live="polite">
          {t("appOps.logs.shown", { shown: visible.length, total: stream.lines.length })}
          {paused && stream.pending ? ` — ${t("appOps.logs.pausedPending", { count: stream.pending })}` : ""}
        </span>
        <div className="flex items-center gap-2">
          <Select
            aria-label={l.download}
            value={dlCount}
            onValueChange={setDlCount}
            options={DOWNLOAD_COUNTS.map((n) => ({ value: String(n), label: t("appOps.logs.downloadCount", { count: n }) }))}
            className="w-40"
          />
          <Button variant="secondary" size="sm" onClick={onDownload} disabled={visible.length === 0}>
            <Download aria-hidden className="size-4" />
            {l.download}
          </Button>
        </div>
      </div>
      {stream.dropped > 0 ? <p className="text-xs text-muted">{t("appOps.logs.capNote", { count: 2000 })}</p> : null}
    </div>
  );
}

export function LogsTab({ name }: AppPanelProps) {
  const [release, setRelease] = useState(ALL);
  const releases = useReleasesPage(name, 1, 20);
  const options = [
    { value: ALL, label: l.allReleases },
    ...(releases.data?.releases ?? []).map((r) => ({ value: r.id, label: r.tag ?? r.id })),
  ];
  const selected = releases.data?.releases.find((r) => r.id === release);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{l.release}</span>
        <Select
          aria-label={l.release}
          value={release}
          onValueChange={setRelease}
          options={options}
          className="w-52"
          disabled={releases.isPending && !releases.data}
        />
      </div>
      <LiveLogs
        key={release}
        name={name}
        releaseId={release === ALL ? undefined : release}
        sinceIso={selected?.createdAt}
      />
    </div>
  );
}
