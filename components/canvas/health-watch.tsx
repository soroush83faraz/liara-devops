"use client";

import { Bell, BellRing, Stethoscope } from "lucide-react";
import { useEffect, useRef } from "react";
import { useShellStore } from "@/components/shell/shell-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { activeAlerts, useHealthStore, type HealthAlert } from "@/lib/canvas/health-store";
import { parseServiceId } from "@/lib/canvas/service-id";
import { relativeTime, faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

const nameOf = (serviceId: string) => parseServiceId(serviceId).name;

function investigate(serviceId: string) {
  useShellStore.getState().openService(serviceId, "copilot");
}

/** Raises one toast per new alert. Alerts that already existed when the indicator mounted stay quiet. */
function useAlertToasts() {
  const { toast, dismiss } = useToast();
  const seen = useRef<Set<string> | null>(null);
  const alerts = useHealthStore((s) => s.alerts);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(alerts.map((a) => a.id));
      return;
    }
    for (const alert of alerts) {
      if (seen.current.has(alert.id)) continue;
      seen.current.add(alert.id);
      const name = nameOf(alert.serviceId);
      const id = toast({
        variant: "error",
        duration: 0,
        title: t("canvasMap.health.alertTitle", { name: `\u2068${name}\u2069` }),
        description: (
          <span className="flex flex-col items-start gap-2">
            <span>{t("canvasMap.health.alertBody")}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                investigate(alert.serviceId);
                dismiss(id);
              }}
            >
              <Stethoscope aria-hidden className="size-4" />
              {t("canvasMap.health.investigate")}
            </Button>
          </span>
        ),
      });
    }
  }, [alerts, toast, dismiss]);
}

function AlertItem({ alert }: { alert: HealthAlert }) {
  const dismissAlert = useHealthStore((s) => s.dismissAlert);
  return (
    <DropdownMenuItem
      onSelect={() => {
        investigate(alert.serviceId);
        dismissAlert(alert.id);
      }}
      className="flex-col items-start gap-1"
    >
      <span className="font-medium">
        <bdi dir="ltr">{nameOf(alert.serviceId)}</bdi> {t("canvasMap.health.notResponding")}
      </span>
      <span className="text-xs text-muted">{t("canvasMap.health.alertSince", { time: relativeTime(alert.raisedAt) })}</span>
      <span className="inline-flex items-center gap-1 text-xs text-accent">
        <Stethoscope aria-hidden className="size-3.5" />
        {t("canvasMap.health.investigate")}
      </span>
    </DropdownMenuItem>
  );
}

/** TopBar `healthWatch` slot: bell with a persistent badge while any service is failing. Polling, not webhooks. */
export function HealthWatchIndicator() {
  useAlertToasts();
  const alerts = useHealthStore((s) => s.alerts);
  const watched = useHealthStore((s) => Object.keys(s.byService).length);
  const dismissAll = useHealthStore((s) => s.dismissAll);
  const active = activeAlerts(alerts);
  const count = active.length;
  const Icon = count > 0 ? BellRing : Bell;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={count > 0 ? t("canvasMap.health.bellLabelCount", { count }) : t("canvasMap.health.bellLabel")}
        className="relative inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:size-10"
      >
        <Icon aria-hidden className={cn("size-5", count > 0 && "text-danger")} />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute end-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-danger-foreground"
          >
            {faNumber(count)}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel>{t("canvasMap.health.title")}</DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs leading-6 text-muted">{t("canvasMap.health.polling")}</p>
        <DropdownMenuSeparator />
        {count === 0 ? (
          <p className="px-2 py-2 text-sm text-muted">
            {watched > 0 ? t("canvasMap.health.allGood") : t("canvasMap.health.noProbes")}
          </p>
        ) : (
          <>
            {active.map((a) => (
              <AlertItem key={a.id} alert={a} />
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={dismissAll}>{t("canvasMap.health.dismissAll")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
