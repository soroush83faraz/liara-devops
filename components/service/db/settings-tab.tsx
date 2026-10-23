"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, LayoutDashboard, Power, ShieldAlert, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Select, Skeleton, TypeToConfirm, useToast } from "@/components/ui";
import { useShellStore } from "@/components/shell/shell-store";
import { faPrice } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { runOp } from "@/lib/client/ops";
import { dbKeys, dbPath, fetchJson, postJson } from "@/lib/service/db/client";
import { planMonthlyText } from "@/lib/service/db/format";
import type { PlanOptionDto } from "@/lib/service/db/plans";
import type { DbPlansDto } from "@/lib/service/db/types";
import { errorMessage, QueryError, SectionCard, type DbPanelProps } from "./shared";
import { useDbOverview } from "./use-db";

type Notice = { title: string; description?: string };

/** Runs a settings POST, refreshes the panel data and surfaces success/failure as toasts. Rethrows so the confirm dialog stays open. */
function useSettingsAction(host: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return async function run(sub: string, body: Record<string, unknown>, done: Notice) {
    try {
      await postJson(dbPath(host, `settings/${sub}`), body);
      toast({ variant: "success", title: done.title, description: done.description });
      await qc.invalidateQueries({ queryKey: dbKeys.all(host) });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    } catch (e) {
      toast({ variant: "error", title: t("dbPanel.common.actionFailed"), description: errorMessage(e) });
      throw e;
    }
  };
}

function Block({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return (
    <SectionCard title={title} icon={icon} description={description}>
      <div className="flex flex-col gap-3">{children}</div>
    </SectionCard>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
      <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function PublicNetworkBlock({ host, enabled }: { host: string; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const run = useSettingsAction(host);
  return (
    <Block title={t("dbPanel.settings.publicTitle")} description={t("dbPanel.settings.publicDescription")} icon={<Globe />}>
      {enabled ? <Warning>{t("dbPanel.overview.publicWarningBody")}</Warning> : <Warning>{t("dbPanel.settings.publicRisk")}</Warning>}
      <div>
        <Button variant={enabled ? "secondary" : "primary"} onClick={() => setOpen(true)}>
          {enabled ? t("dbPanel.settings.publicDisable") : t("dbPanel.settings.publicEnable")}
        </Button>
      </div>
      <TypeToConfirm
        open={open}
        onOpenChange={setOpen}
        name={host}
        danger={!enabled}
        title={enabled ? t("dbPanel.settings.publicDisableTitle") : t("dbPanel.settings.publicEnableTitle")}
        confirmLabel={enabled ? t("dbPanel.settings.publicDisable") : t("dbPanel.settings.publicEnable")}
        onConfirm={() => run("public-network", { enable: !enabled, typedName: host }, { title: t("dbPanel.settings.publicDone") })}
      >
        <p className="text-sm leading-7">{enabled ? t("dbPanel.settings.publicDisableNote") : t("dbPanel.settings.publicRisk")}</p>
      </TypeToConfirm>
    </Block>
  );
}

function PowerBlock({ host, stopped }: { host: string; stopped: boolean }) {
  const [open, setOpen] = useState(false);
  const run = useSettingsAction(host);
  return (
    <Block title={t("dbPanel.settings.powerTitle")} description={t("dbPanel.settings.powerDescription")} icon={<Power />}>
      <div>
        <Button variant={stopped ? "primary" : "secondary"} onClick={() => setOpen(true)}>
          {stopped ? t("dbPanel.settings.powerStart") : t("dbPanel.settings.powerStop")}
        </Button>
      </div>
      <TypeToConfirm
        open={open}
        onOpenChange={setOpen}
        name={host}
        danger={!stopped}
        title={stopped ? t("dbPanel.settings.powerStartTitle") : t("dbPanel.settings.powerStopTitle")}
        confirmLabel={stopped ? t("dbPanel.settings.powerStart") : t("dbPanel.settings.powerStop")}
        onConfirm={() =>
          run(
            "power",
            { scale: stopped ? 1 : 0, typedName: host },
            { title: stopped ? t("dbPanel.settings.powerStartDone") : t("dbPanel.settings.powerStopDone") },
          )
        }
      >
        {stopped ? null : <p className="text-sm leading-7">{t("dbPanel.settings.powerStopWarning")}</p>}
        <p className="text-sm leading-7 text-muted">{t("dbPanel.settings.powerBilling")}</p>
      </TypeToConfirm>
    </Block>
  );
}

function planLabel(p: PlanOptionDto): string {
  const specs =
    p.ramGb !== undefined && p.cpu !== undefined
      ? ` · ${t("dbPanel.settings.planLine", { ram: `${p.ramGb} ${t("dbPanel.settings.planRamUnit")}`, cpu: p.cpu })}`
      : "";
  return `${p.id}${specs} · ${planMonthlyText(p)}${p.current ? ` · ${t("dbPanel.settings.currentTag")}` : ""}`;
}

function CostSummary({ plan, current }: { plan: PlanOptionDto; current: PlanOptionDto | undefined }) {
  const delta = plan.deltaPerMonth;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-surface-muted p-3 text-sm">
      {current ? (
        <>
          <dt className="text-muted">{t("dbPanel.settings.costCurrent")}</dt>
          <dd>{planMonthlyText(current)}</dd>
        </>
      ) : null}
      <dt className="text-muted">{t("dbPanel.settings.costNew")}</dt>
      <dd className="font-semibold">{planMonthlyText(plan)}</dd>
      <dt className="text-muted">{t("dbPanel.settings.costDelta")}</dt>
      <dd className="font-semibold">
        {plan.direction === "unknown"
          ? !plan.priceKnown || (current && !current.priceKnown)
            ? t("dbPanel.settings.costDeltaUnknown")
            : t("dbPanel.settings.costUnknown")
          : plan.direction === "same" || delta === undefined
            ? t("dbPanel.settings.costSame")
            : plan.direction === "up"
              ? t("dbPanel.settings.costUp", { price: faPrice(delta) })
              : t("dbPanel.settings.costDown", { price: faPrice(Math.abs(delta)) })}
      </dd>
      <dd className="col-span-2 text-xs text-muted">{t("dbPanel.settings.costPerMonthNote")}</dd>
    </dl>
  );
}

function ResizeBlock({ host }: { host: string }) {
  const [choice, setChoice] = useState<string>("");
  const [open, setOpen] = useState(false);
  const run = useSettingsAction(host);
  const q = useQuery({
    queryKey: dbKeys.plans(host),
    queryFn: ({ signal }) => fetchJson<DbPlansDto>(dbPath(host, "plans"), signal),
    staleTime: 60_000,
  });
  const plans = q.data?.plans ?? [];
  const current = plans.find((p) => p.current);
  const selected = plans.find((p) => p.id === choice && !p.current);

  return (
    <Block title={t("dbPanel.settings.resizeTitle")} description={t("dbPanel.settings.resizeDescription")} icon={<SlidersHorizontal />}>
      {q.isPending ? (
        <Skeleton className="h-11 w-full" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : plans.filter((p) => !p.current).length === 0 ? (
        <p className="text-sm text-muted">{t("dbPanel.settings.resizeNoPlans")}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">
              {t("dbPanel.settings.resizeChoose")}
            </span>
            <Select
              aria-label={t("dbPanel.settings.resizeChoose")}
              placeholder={t("dbPanel.settings.resizePlaceholder")}
              value={choice || undefined}
              onValueChange={setChoice}
              options={plans.map((p) => ({ value: p.id, label: planLabel(p), disabled: p.current }))}
            />
          </div>
          {selected ? <CostSummary plan={selected} current={current} /> : null}
          <div>
            <Button disabled={!selected} onClick={() => setOpen(true)}>
              {t("dbPanel.settings.resizeAction")}
            </Button>
          </div>
          {selected ? (
            <TypeToConfirm
              open={open}
              onOpenChange={setOpen}
              name={host}
              title={t("dbPanel.settings.resizeConfirmTitle")}
              confirmLabel={t("dbPanel.settings.resizeAction")}
              onConfirm={() => run("resize", { planID: selected.id, typedName: host }, { title: t("dbPanel.settings.resizeDone") })}
            >
              <CostSummary plan={selected} current={current} />
              <Warning>{t("dbPanel.settings.resizeDowntime")}</Warning>
            </TypeToConfirm>
          ) : null}
        </>
      )}
    </Block>
  );
}

function ControlPanelBlock({ host }: { host: string }) {
  const [mode, setMode] = useState<"enable" | "disable" | null>(null);
  const run = useSettingsAction(host);
  return (
    <Block title={t("dbPanel.settings.controlTitle")} description={t("dbPanel.settings.controlDescription")} icon={<LayoutDashboard />}>
      <Warning>{t("dbPanel.settings.controlRisk")}</Warning>
      <p className="text-xs leading-6 text-muted">{t("dbPanel.settings.controlStateNote")}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setMode("enable")}>{t("dbPanel.settings.controlEnable")}</Button>
        <Button variant="secondary" onClick={() => setMode("disable")}>
          {t("dbPanel.settings.controlDisable")}
        </Button>
      </div>
      <TypeToConfirm
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}
        name={host}
        title={mode === "disable" ? t("dbPanel.settings.controlDisableTitle") : t("dbPanel.settings.controlEnableTitle")}
        confirmLabel={mode === "disable" ? t("dbPanel.settings.controlDisable") : t("dbPanel.settings.controlEnable")}
        onConfirm={() =>
          run(
            "control-panel",
            { enable: mode !== "disable", typedName: host },
            { title: mode === "disable" ? t("dbPanel.settings.controlDisableDone") : t("dbPanel.settings.controlEnableDone") },
          )
        }
      >
        {mode === "disable" ? null : <p className="text-sm leading-7">{t("dbPanel.settings.controlRisk")}</p>}
      </TypeToConfirm>
    </Block>
  );
}

function DangerZone({ host }: { host: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const closeService = useShellStore((s) => s.closeService);

  async function remove() {
    try {
      await runOp({ params: { type: "delete_db", db: host }, typedName: host });
    } catch (e) {
      toast({ variant: "error", title: t("dbPanel.common.actionFailed"), description: errorMessage(e) });
      throw e;
    }
    toast({ variant: "success", title: t("dbPanel.settings.deleteDone"), description: t("dbPanel.settings.deleteDoneBody") });
    qc.removeQueries({ queryKey: dbKeys.all(host) });
    void qc.invalidateQueries({ queryKey: ["overview"] });
    closeService();
  }

  return (
    <section aria-label={t("dbPanel.settings.dangerTitle")} className="flex flex-col gap-3 rounded-xl border border-danger/50 p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold leading-8 text-danger">
        <ShieldAlert aria-hidden className="size-4" />
        {t("dbPanel.settings.dangerTitle")}
      </h3>
      <div>
        <p className="font-medium">{t("dbPanel.settings.deleteTitle")}</p>
        <p className="text-sm leading-7 text-muted">{t("dbPanel.settings.deleteDescription")}</p>
      </div>
      <div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          {t("dbPanel.settings.deleteAction")}
        </Button>
      </div>
      <TypeToConfirm
        open={open}
        onOpenChange={setOpen}
        name={host}
        danger
        title={t("dbPanel.settings.deleteConfirmTitle")}
        confirmLabel={t("dbPanel.settings.deleteConfirmLabel")}
        onConfirm={remove}
      >
        <p className="text-sm font-medium leading-7 text-danger-ink">{t("dbPanel.settings.deleteWarning")}</p>
      </TypeToConfirm>
    </section>
  );
}

export function DbSettingsTab({ name }: DbPanelProps) {
  const q = useDbOverview(name);
  if (q.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  return (
    <div className="flex flex-col gap-4">
      <PublicNetworkBlock host={name} enabled={q.data.publicNetwork} />
      <PowerBlock host={name} stopped={q.data.uiStatus === "stopped"} />
      <ResizeBlock host={name} />
      <ControlPanelBlock host={name} />
      <DangerZone host={name} />
    </div>
  );
}
