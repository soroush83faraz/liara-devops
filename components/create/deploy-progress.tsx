"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, ExternalLink, SquareTerminal } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { Button, ErrorBanner } from "@/components/ui";
import { BuildLogPanel } from "@/components/service/app/releases/build-log-panel";
import { ReleaseStateBadge } from "@/components/service/app/overview/release-state-badge";
import { defaultAppUrl } from "@/lib/canvas/urls";
import { fetchJson } from "@/lib/service/app-read/client";
import { isTerminalState } from "@/lib/service/app-read/release-utils";
import type { ReleaseDto } from "@/lib/service/app-read/types";
import { useShellStore } from "@/components/shell/shell-store";
import { Pulse, spring } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { tk } from "./parts";

/** Live build log (SSE, reused from the Releases tab) + polled state, fail reason and the app link once done. */
export function DeployProgress({ appName, releaseId, onFinish, onRetry }: { appName: string; releaseId: string; onFinish: () => void; onRetry: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["release", releaseId, "deploy-progress"],
    queryFn: ({ signal }) => fetchJson<ReleaseDto>(`/api/releases/${encodeURIComponent(releaseId)}`, signal),
    refetchInterval: (query) => (query.state.data && isTerminalState(query.state.data.state) ? false : 3000),
    retry: 2,
  });
  const release = q.data;
  const done = !!release && isTerminalState(release.state);
  const ok = release?.state.toUpperCase() === "READY";

  useEffect(() => {
    if (done) {
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["app"] });
    }
  }, [done, qc]);

  const url = defaultAppUrl(appName);
  const stub: ReleaseDto = { id: releaseId, state: release?.state ?? "DEPLOYING", isCurrent: false, live: true };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {release ? <ReleaseStateBadge state={release.state} /> : null}
        {release?.queue ? <span className="text-sm text-muted">{tk("deploy.queue", { count: release.queue })}</span> : null}
        <span className="text-xs text-muted">
          {tk("deploy.releaseId")}: <bdi dir="ltr" className="font-mono">{releaseId}</bdi>
        </span>
      </div>
      {q.isError && !release ? <ErrorBanner tone="warn" message={tk("deploy.stateLoadFailed")} /> : null}
      <div role="status" aria-live="polite">
        {done ? (
          <motion.p
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={spring.pop}
            className={cn(
              "flex items-start gap-3 rounded-md border p-3 text-sm leading-7",
              ok ? "border-ok/40 bg-ok-soft text-ok-ink" : "border-danger/40 bg-danger-soft text-danger-ink",
            )}
          >
            {ok ? <CircleCheck aria-hidden className="mt-1 size-5 shrink-0" /> : <CircleX aria-hidden className="mt-1 size-5 shrink-0" />}
            <span>
              {ok ? tk("deploy.doneOk") : tk("deploy.doneFail")}
              {!ok && release?.failReason ? (
                <>
                  <br />
                  {tk("deploy.failReason", { reason: release.failReason })}
                </>
              ) : null}
            </span>
          </motion.p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-code-bg">
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted/60 px-3 py-2">
          <Pulse tone={done ? (ok ? "ok" : "danger") : "accent"} active={!done} />
          <SquareTerminal aria-hidden className="size-4 text-muted" />
          <bdi dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
            {appName}
          </bdi>
        </div>
        <div className="p-3">
          <BuildLogPanel release={stub} appName={appName} />
        </div>
      </div>
      <p className="text-xs text-muted">{tk("deploy.warnClose")}</p>
      <div className="flex flex-wrap gap-2">
        {ok && url ? (
          <Button variant="primary" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
            <ExternalLink aria-hidden className="size-4" />
            {tk("deploy.openApp")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => {
            useShellStore.getState().openService(appName, "releases");
            onFinish();
          }}
        >
          {tk("deploy.viewReleases")}
        </Button>
        {done && !ok ? (
          <Button variant="secondary" onClick={onRetry}>
            {tk("deploy.tryAgain")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onFinish}>
          {tk("deploy.finish")}
        </Button>
      </div>
    </div>
  );
}
