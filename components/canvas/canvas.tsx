"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Database, LayoutList, LayoutGrid, Network, Plus, RefreshCw, Server, Wand2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { tk } from "@/components/create/parts";
import { useHealthStore } from "@/lib/canvas/health-store";
import { canvasLoadError, type CanvasLoadError } from "@/lib/canvas/load-error";
import { openAppDialog, openDbDialog, openNetworkDialog } from "@/lib/create/store";
import { useCountdown } from "@/lib/service/app-config/client";
import { useMediaQuery } from "@/components/shell/use-media-query";
import { useProbe } from "@/lib/canvas/use-probe";
import { ApiError, useOverview } from "@/lib/canvas/use-overview";
import type { Overview } from "@/lib/canvas/types";
import { faTime, relativeTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import { CreateMenuSlot, hasCreateMenu } from "./create-slot";
import { ServiceList } from "./service-list";

const FlowCanvas = dynamic(() => import("./flow-canvas"), { ssr: false, loading: () => <CanvasSkeleton /> });

const VIEW_KEY = "hamyar:view";

export function CanvasSkeleton() {
  return (
    <div aria-busy aria-label={t("canvasMap.loading")} className="bg-dot-grid size-full min-h-80 p-6">
      <div className="mx-auto mt-6 grid max-w-3xl gap-x-12 gap-y-10 rounded-lg border border-dashed border-border-strong/30 p-7 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-24 flex-col justify-between rounded-md border border-border bg-surface p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

function readView(): "list" | "canvas" | null {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === "list" || v === "canvas" ? v : null;
  } catch {
    return null;
  }
}

function PartialNotices({ overview }: { overview: Overview }) {
  const notes: string[] = [];
  if (overview.errors.databases) notes.push(t("canvasMap.errors.databases"));
  if (overview.errors.networks) notes.push(t("canvasMap.errors.networks"));
  if (overview.errors.billing) notes.push(t("canvasMap.errors.billing"));
  if (overview.edgesPartial && !overview.errors.databases) notes.push(t("canvasMap.errors.edgesPartial"));
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2 px-4 pt-3">
      {notes.map((n) => (
        <li key={n}>
          <ErrorBanner tone="warn" message={n} />
        </li>
      ))}
    </ul>
  );
}

/** 429: live countdown, then one automatic retry when it elapses. */
function RateLimitNotice({ seconds, onElapsed }: { seconds: number; onElapsed: () => void }) {
  const left = useCountdown(seconds);
  const fired = useRef(false);
  useEffect(() => {
    if (left > 0 || fired.current) return;
    fired.current = true;
    onElapsed();
  }, [left, onElapsed]);
  return <>{t("canvasMap.errors.rateLimited", { seconds: left })}</>;
}

/** `attempt` (the error's timestamp) restarts the countdown for every new 429. */
function LoadErrorMessage({ err, attempt, onRetry }: { err: CanvasLoadError; attempt: number; onRetry: () => void }) {
  return err.retryAfterSec ? <RateLimitNotice key={attempt} seconds={err.retryAfterSec} onElapsed={onRetry} /> : <>{err.message}</>;
}

/** Refetch failed while cached data is shown: persistent, unobtrusive, with the age of what is on screen. */
function StaleDataBanner({
  error,
  attempt,
  updatedAt,
  onRetry,
  retrying,
}: {
  error: unknown;
  attempt: number;
  updatedAt: number;
  onRetry: () => void;
  retrying: boolean;
}) {
  const err = canvasLoadError(error);
  return (
    <div className="px-4 pt-3" data-testid="canvas-stale-banner">
      <ErrorBanner
        tone="warn"
        message={`${t("canvasMap.errors.refreshFailed", { time: faTime(updatedAt) })}${err.retryAfterSec ? "" : ` ${err.message}`}`}
        onRetry={onRetry}
        retrying={retrying}
      />
      {err.retryAfterSec ? (
        <p className="mt-1 text-xs text-muted" role="status">
          <LoadErrorMessage err={err} attempt={attempt} onRetry={onRetry} />
        </p>
      ) : null}
    </div>
  );
}

/** Probe calls answered 401: probing stopped. Ask to reconnect instead of silently freezing the badges. */
function ProbeSessionNotice() {
  const expired = useHealthStore((s) => s.sessionExpired);
  if (!expired) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
      <ErrorBanner tone="warn" message={t("canvasMap.errors.probeSessionExpired")} className="min-w-0 flex-1" />
      <Link href="/connect" className={buttonVariants({ size: "sm" })}>
        {t("canvasMap.errors.reconnectCta")}
      </Link>
    </div>
  );
}

/** Empty state: the primary «افزودن» action (same three creators as the toolbar menu, whose host renders the dialogs). */
function EmptyCreateButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus aria-hidden className="size-4" />
          {tk("menu.add")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => openAppDialog()}>
          <Server aria-hidden className="size-4 text-muted" />
          {tk("menu.app")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDbDialog()}>
          <Database aria-hidden className="size-4 text-muted" />
          {tk("menu.db")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openNetworkDialog()}>
          <Network aria-hidden className="size-4 text-muted" />
          {tk("menu.network")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Compact one-line page header: the title, then how fresh the map is. */
function PageHeader({ overview, children }: { overview: Overview; children?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-border bg-surface/60 px-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="shrink-0 text-[17px] font-bold leading-7">{t("canvasMap.title")}</h1>
        <p className="min-w-0 truncate text-xs text-muted" title={t("canvasMap.pollingNote")}>
          <span className="max-md:hidden">{t("canvasMap.pollingNote")} · </span>
          {t("canvasMap.updatedAt", { time: relativeTime(overview.generatedAt) })}
        </p>
      </div>
      {children}
    </div>
  );
}

/** Visible label that collapses to icon-only under 900 px (the text stays the accessible name). */
const LABEL = "max-[900px]:sr-only";

/**
 * Canvas actions. `floating`: a pill pinned top-start inside the canvas (it never wraps; under 900 px the buttons
 * collapse to icons). Otherwise it sits inline at the end of the page header (list view).
 */
function Toolbar({
  isList,
  canToggle,
  fetching,
  floating,
  onToggle,
  onRefresh,
  onReset,
}: {
  isList: boolean;
  canToggle: boolean;
  fetching: boolean;
  floating: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onReset: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={t("canvasMap.toolbar")}
      className={cn(
        "flex shrink-0 items-center gap-1",
        floating &&
          "absolute start-3 top-3 z-10 rounded-md border border-border bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] p-1 shadow-[var(--shadow-pop)] hl-enter",
        // The create menu's trigger (owned by the create unit) also collapses to its icon under 900 px.
        "max-[900px]:[&_[aria-haspopup]]:min-w-11 max-[900px]:[&_[aria-haspopup]]:gap-0 max-[900px]:[&_[aria-haspopup]]:px-2 max-[900px]:[&_[aria-haspopup]]:text-[0px]",
      )}
    >
      <CreateMenuSlot />
      {canToggle ? (
        <>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          {!isList ? (
            <Button variant="ghost" size="sm" onClick={onReset} title={t("canvasMap.autoLayout")}>
              <Wand2 aria-hidden className="size-4 text-muted" />
              <span className={LABEL}>{t("canvasMap.autoLayout")}</span>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onToggle} aria-pressed={isList} title={isList ? t("canvasMap.viewCanvas") : t("canvasMap.viewList")}>
            {isList ? <LayoutGrid aria-hidden className="size-4 text-muted" /> : <LayoutList aria-hidden className="size-4 text-muted" />}
            <span className={LABEL}>{isList ? t("canvasMap.viewCanvas") : t("canvasMap.viewList")}</span>
          </Button>
        </>
      ) : null}
      <Button variant="ghost" size="sm" className="min-w-11 md:min-w-8" onClick={onRefresh} loading={fetching} aria-label={t("canvasMap.refresh")} title={t("canvasMap.refresh")}>
        {fetching ? null : <RefreshCw aria-hidden className="size-4 text-muted" />}
        <span className={cn("hidden sm:inline", LABEL)}>{t("canvasMap.refresh")}</span>
      </Button>
    </div>
  );
}

export function Canvas({ accountId }: { accountId: string }) {
  const { data, error, isPending, isFetching, refetch, dataUpdatedAt, errorUpdatedAt } = useOverview();
  const desktop = useMediaQuery("(min-width: 768px)");
  const [preferred, setPreferred] = useState<"list" | "canvas" | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  useProbe(data?.services);

  useEffect(() => {
    // Per-viewer convenience only; read after mount so server and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferred(readView());
  }, []);

  if (error instanceof ApiError && error.status === 401) {
    return (
      <div className="p-6">
        <ErrorBanner
          title={t("canvasMap.errors.title")}
          message={t("canvasMap.errors.reconnect")}
          tone="warn"
        />
        <Link href="/connect" className={buttonVariants({ className: "mt-4" })}>
          {t("canvasMap.errors.reconnectCta")}
        </Link>
      </div>
    );
  }
  if (isPending) return <CanvasSkeleton />;
  if (!data) {
    const err = canvasLoadError(error);
    return (
      <div className="p-6">
        <ErrorBanner
          title={t("canvasMap.errors.title")}
          message={<LoadErrorMessage err={err} attempt={errorUpdatedAt} onRetry={() => void refetch()} />}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      </div>
    );
  }

  const isList = !desktop || preferred === "list";
  const toggle = () => {
    const next = isList ? "canvas" : "list";
    setPreferred(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // not remembered
    }
  };

  const toolbar = (floating: boolean) => (
    <Toolbar
      isList={isList}
      canToggle={desktop}
      fetching={isFetching}
      floating={floating}
      onToggle={toggle}
      onRefresh={() => void refetch()}
      onReset={() => setResetSignal((n) => n + 1)}
    />
  );
  const onCanvas = !isList && data.services.length > 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader overview={data}>{onCanvas ? null : toolbar(false)}</PageHeader>
      {error ? <StaleDataBanner error={error} attempt={errorUpdatedAt} updatedAt={dataUpdatedAt} onRetry={() => void refetch()} retrying={isFetching} /> : null}
      <ProbeSessionNotice />
      <PartialNotices overview={data} />
      {data.services.length === 0 ? (
        <EmptyState
          className="py-20"
          icon={<Network />}
          title={t("canvasMap.empty.title")}
          description={t("canvasMap.empty.body")}
          action={
            hasCreateMenu ? (
              <EmptyCreateButton />
            ) : (
              <Button variant="secondary" disabled>
                {t("canvasMap.empty.createSoon")}
              </Button>
            )
          }
        />
      ) : isList ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ServiceList overview={data} />
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <FlowCanvas overview={data} accountId={accountId} resetSignal={resetSignal} />
          {toolbar(true)}
        </div>
      )}
    </div>
  );
}
