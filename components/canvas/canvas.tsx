"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Database, LayoutList, LayoutGrid, Network, Plus, RefreshCw, Server, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { CreateMenuSlot, hasCreateMenu } from "./create-slot";
import { ServiceList } from "./service-list";

const FlowCanvas = dynamic(() => import("./flow-canvas"), { ssr: false, loading: () => <CanvasSkeleton /> });

const VIEW_KEY = "hamyar:view";

export function CanvasSkeleton() {
  return (
    <div aria-busy aria-label={t("canvasMap.loading")} className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-40 rounded-xl" />
      ))}
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

function Toolbar({
  overview,
  isList,
  canToggle,
  fetching,
  onToggle,
  onRefresh,
  onReset,
}: {
  overview: Overview;
  isList: boolean;
  canToggle: boolean;
  fetching: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
      <div className="min-w-0 flex-1">
        <h1 className="text-base font-semibold leading-8">{t("canvasMap.title")}</h1>
        <p className="text-xs leading-5 text-muted">
          {t("canvasMap.pollingNote")} · {t("canvasMap.updatedAt", { time: relativeTime(overview.generatedAt) })}
        </p>
      </div>
      <CreateMenuSlot />
      {canToggle ? (
        <>
          {!isList ? (
            <Button variant="secondary" size="sm" onClick={onReset}>
              <Wand2 aria-hidden className="size-4" />
              {t("canvasMap.autoLayout")}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onToggle} aria-pressed={isList}>
            {isList ? <LayoutGrid aria-hidden className="size-4" /> : <LayoutList aria-hidden className="size-4" />}
            {isList ? t("canvasMap.viewCanvas") : t("canvasMap.viewList")}
          </Button>
        </>
      ) : null}
      <Button variant="ghost" size="sm" className="min-w-11" onClick={onRefresh} loading={fetching} aria-label={t("canvasMap.refresh")}>
        {fetching ? null : <RefreshCw aria-hidden className="size-4" />}
        <span className="hidden sm:inline">{t("canvasMap.refresh")}</span>
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

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        overview={data}
        isList={isList}
        canToggle={desktop}
        fetching={isFetching}
        onToggle={toggle}
        onRefresh={() => void refetch()}
        onReset={() => setResetSignal((n) => n + 1)}
      />
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
        <div className="min-h-0 flex-1">
          <FlowCanvas overview={data} accountId={accountId} resetSignal={resetSignal} />
        </div>
      )}
    </div>
  );
}
