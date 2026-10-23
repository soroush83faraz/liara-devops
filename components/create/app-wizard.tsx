"use client";

import { CircleCheck } from "lucide-react";
import { useReducer, useRef } from "react";
import { Badge, Button, Field, Input, Switch } from "@/components/ui";
import { runOp } from "@/lib/client/ops";
import type { Platform } from "@/lib/contracts/common";
import { defaultAppUrl } from "@/lib/canvas/urls";
import { formatToman } from "@/lib/create/cost";
import { errorKeyFor, toErrLike } from "@/lib/create/errors";
import { formatCores, formatDisk, formatRam } from "@/lib/create/format";
import { isSelectable } from "@/lib/create/plans";
import { openDeployDialog } from "@/lib/create/store";
import { useAfterCreate, usePlans } from "@/lib/create/use-plans";
import type { AppPlanDto, PlansResponse } from "@/lib/create/types";
import { validateAppName } from "@/lib/create/validators";
import {
  APP_STEPS,
  appReducer,
  appReviewGate,
  canAdvanceApp,
  initialAppState,
  networkNameOf,
  type AppWizardState,
} from "@/lib/create/wizards";
import { useShellStore } from "@/components/shell/shell-store";
import { CardGrid, CostBlock, NavFooter, NetworkPicker, OptionCard, PlansGate, PriceLines, SubmitError, TypedField, WizardDialog, tk } from "./parts";

const platformLabel = (p: string) => {
  const known = (tk(`platforms.${p}.label`) as string);
  return known.startsWith("createFlow.") ? p : known;
};
const platformDesc = (p: string) => {
  const d = tk(`platforms.${p}.desc`) as string;
  return d.startsWith("createFlow.") ? undefined : d;
};

function Specs({ plan }: { plan: Pick<AppPlanDto, "ramMb" | "cpu" | "diskGb"> }) {
  const items = [
    formatRam(plan.ramMb) && tk("plan.ram", { value: formatRam(plan.ramMb)! }),
    formatCores(plan.cpu) && tk("plan.cpu", { value: formatCores(plan.cpu)! }),
    formatDisk(plan.diskGb) && tk("plan.disk", { value: formatDisk(plan.diskGb)! }),
  ].filter(Boolean);
  return <span className="text-xs leading-6 text-muted">{items.join(" · ")}</span>;
}

export function AppWizard({ onClose, network }: { onClose: () => void; network?: string }) {
  const [s, dispatch] = useReducer(appReducer, network, initialAppState);
  const plansQ = usePlans();
  const afterCreate = useAfterCreate();
  const inflight = useRef(false);
  const busy = s.submit.phase === "pending";

  async function submit(plans: PlansResponse) {
    if (inflight.current || !appReviewGate(s, plans).canSubmit) return;
    inflight.current = true;
    dispatch({ type: "submit_start" });
    try {
      if (s.network.mode === "new" && !s.networkCreated) {
        await runOp({ params: { type: "create_network", name: s.network.name }, typedName: s.typedNetwork });
        dispatch({ type: "stage_network_done" });
      }
      await runOp({
        params: {
          type: "create_app",
          name: s.name,
          platform: s.platform as Platform,
          planId: s.planId!,
          ...(s.bundlePlanId ? { bundlePlanId: s.bundlePlanId } : {}),
          ...(networkNameOf(s.network) ? { network: networkNameOf(s.network) } : {}),
        },
        typedName: s.typedName,
      });
      await afterCreate();
      dispatch({ type: "submit_success" });
    } catch (e) {
      const err = toErrLike(e);
      dispatch({ type: "submit_error", errorKey: errorKeyFor(err, "create"), retryAfterSec: err.retryAfterSec });
    } finally {
      inflight.current = false;
    }
  }

  if (s.step === "done") return <Done name={s.name} platform={s.platform} onClose={onClose} />;

  const stepIndex = APP_STEPS.indexOf(s.step);
  const labels = APP_STEPS.map((k) => tk(`app.steps.${k}`));
  return (
    <WizardDialog title={tk("app.title")} stepLabels={labels} stepIndex={stepIndex} busy={busy} onClose={onClose} footer={<Footer s={s} dispatch={dispatch} plansQ={plansQ.data} onClose={onClose} onSubmit={submit} />}>
      <PlansGate query={plansQ}>
        {(plans) => (
          <div className="flex flex-col gap-4">
            {s.step === "name" ? <NameStep s={s} dispatch={dispatch} /> : null}
            {s.step === "platform" ? <PlatformStep s={s} plans={plans} dispatch={dispatch} /> : null}
            {s.step === "plan" ? <PlanStep s={s} plans={plans} dispatch={dispatch} /> : null}
            {s.step === "network" ? <NetworkPicker plans={plans} value={s.network} onChange={(network) => dispatch({ type: "set_network", network })} /> : null}
            {s.step === "review" ? <Review s={s} plans={plans} dispatch={dispatch} /> : null}
          </div>
        )}
      </PlansGate>
    </WizardDialog>
  );
}

type Dispatch = (a: Parameters<typeof appReducer>[1]) => void;

function Footer({ s, dispatch, plansQ, onClose, onSubmit }: { s: AppWizardState; dispatch: Dispatch; plansQ?: PlansResponse; onClose: () => void; onSubmit: (p: PlansResponse) => Promise<void> }) {
  const busy = s.submit.phase === "pending";
  if (!plansQ) return <NavFooter onCancel={onClose} />;
  const back = s.step === "name" ? undefined : () => dispatch({ type: "back" });
  if (s.step === "review") {
    const gate = appReviewGate(s, plansQ);
    return <NavFooter onCancel={onClose} onBack={back} onNext={() => void onSubmit(plansQ)} nextLabel={busy ? (s.submit.phase === "pending" && s.submit.stage === "network" ? tk("common.creatingNetwork") : tk("common.creating")) : tk("app.submit")} nextDisabled={!gate.canSubmit} busy={busy} />;
  }
  return <NavFooter onCancel={onClose} onBack={back} onNext={() => dispatch({ type: "next", plans: plansQ })} nextDisabled={!canAdvanceApp(s, plansQ)} />;
}

function NameStep({ s, dispatch }: { s: AppWizardState; dispatch: Dispatch }) {
  const code = s.name ? validateAppName(s.name) : null;
  const url = !code && s.name ? defaultAppUrl(s.name) : undefined;
  return (
    <Field label={tk("app.nameLabel")} hint={tk("app.nameHint")} error={code ? tk(`validation.${code}`) : undefined}>
      {(p) => (
        <>
          <Input {...p} dir="ltr" autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} value={s.name} onChange={(e) => dispatch({ type: "set_name", name: e.target.value })} className="text-start font-mono" />
          {url ? (
            <p className="text-xs text-muted">
              {tk("app.namePreview")}: <bdi dir="ltr" className="font-mono">{url}</bdi>
            </p>
          ) : null}
        </>
      )}
    </Field>
  );
}

function PlatformStep({ s, plans, dispatch }: { s: AppWizardState; plans: PlansResponse; dispatch: Dispatch }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{tk("app.platformTitle")}</h4>
      <CardGrid label={tk("app.platformTitle")} className="sm:grid-cols-2">
        {plans.platforms.map((p) => (
          <OptionCard key={p} name="platform" value={p} checked={s.platform === p} onChange={(platform) => dispatch({ type: "set_platform", platform })} title={<bdi dir="ltr">{platformLabel(p)}</bdi>} subtitle={platformDesc(p)} />
        ))}
      </CardGrid>
    </div>
  );
}

function PlanStep({ s, plans, dispatch }: { s: AppWizardState; plans: PlansResponse; dispatch: Dispatch }) {
  const bundles = s.planId ? (plans.bundlePlans[s.planId] ?? []) : [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">{tk("app.planTitle")}</h4>
        <p className="text-xs leading-6 text-muted">{tk("app.planHint")}</p>
        {plans.filtered.apps ? <p className="text-xs leading-6 text-muted">{tk("common.planFiltered")}</p> : null}
        {plans.appPlans.length === 0 ? <p className="text-sm text-danger">{tk("common.noPlans")}</p> : null}
        <CardGrid label={tk("app.planTitle")}>
          {plans.appPlans.map((p) => (
            <OptionCard key={p.id} name="plan" value={p.id} checked={s.planId === p.id} disabled={!isSelectable(p)} onChange={(planId) => dispatch({ type: "set_plan", planId, plans })} title={<bdi dir="ltr" className="font-mono">{p.label}</bdi>} subtitle={<Specs plan={p} />}>
              {p.hourlyToman !== undefined && p.monthlyToman !== undefined ? <PriceLines hourly={p.hourlyToman} monthly={p.monthlyToman} /> : <span className="text-xs text-danger">{tk("common.priceUnknown")}</span>}
            </OptionCard>
          ))}
        </CardGrid>
      </div>
      {bundles.length > 1 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{tk("app.bundleTitle")}</h4>
          <p className="text-xs leading-6 text-muted">{tk("app.bundleHint")}</p>
          <CardGrid label={tk("app.bundleTitle")}>
            {bundles.map((b) => (
              <OptionCard key={b.id} name="bundle" value={b.id} checked={s.bundlePlanId === b.id} onChange={(bundlePlanId) => dispatch({ type: "set_bundle", bundlePlanId })} title={<bdi dir="ltr" className="font-mono">{b.label}</bdi>} subtitle={b.displayPrice !== undefined ? tk("cost.bundleCard", { amount: formatToman(b.displayPrice) }) : undefined} />
            ))}
          </CardGrid>
        </div>
      ) : null}
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function Review({ s, plans, dispatch }: { s: AppWizardState; plans: PlansResponse; dispatch: Dispatch }) {
  const gate = appReviewGate(s, plans);
  const busy = s.submit.phase === "pending";
  const bundle = s.planId ? plans.bundlePlans[s.planId]?.find((b) => b.id === s.bundlePlanId) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <h4 className="text-sm font-semibold">{tk("app.reviewTitle")}</h4>
      <dl className="divide-y divide-border rounded-xl border border-border px-3">
        <Row k={tk("app.summaryName")}><bdi dir="ltr" className="font-mono">{s.name}</bdi></Row>
        <Row k={tk("app.summaryPlatform")}><bdi dir="ltr">{platformLabel(s.platform ?? "")}</bdi></Row>
        <Row k={tk("app.summaryPlan")}><bdi dir="ltr" className="font-mono">{s.planId}</bdi></Row>
        {bundle ? <Row k={tk("app.summaryBundle")}><bdi dir="ltr" className="font-mono">{bundle.id}</bdi></Row> : null}
        <Row k={tk("app.summaryNetwork")}>{s.network.mode === "none" ? tk("common.noNetwork") : <bdi dir="ltr" className="font-mono">{s.network.name}</bdi>}{s.network.mode === "new" ? <Badge tone="accent" className="ms-2">{tk("netPicker.createNew")}</Badge> : null}</Row>
      </dl>
      <CostBlock cost={gate.cost} balance={gate.balance} bundle={bundle} />
      <Switch label={tk("common.iUnderstand")} checked={s.ack} onCheckedChange={(ack) => dispatch({ type: "set_ack", ack })} disabled={busy} />
      {s.network.mode === "new" && !s.networkCreated ? <TypedField label={tk("typed.networkLabel")} name={s.network.name} value={s.typedNetwork} onChange={(typed) => dispatch({ type: "set_typed_network", typed })} disabled={busy} /> : null}
      <TypedField label={tk("typed.label")} name={s.name} value={s.typedName} onChange={(typed) => dispatch({ type: "set_typed_name", typed })} disabled={busy} />
      <SubmitError submit={s.submit} />
    </div>
  );
}

function Done({ name, platform, onClose }: { name: string; platform?: string; onClose: () => void }) {
  return (
    <WizardDialog
      title={tk("app.doneTitle")}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              useShellStore.getState().openService(name);
              onClose();
            }}
          >
            {tk("app.openPanel")}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {tk("app.later")}
          </Button>
          <Button onClick={() => openDeployDialog(name, platform)}>{tk("app.deployFirst")}</Button>
        </>
      }
    >
      <p className="flex items-start gap-2 text-sm leading-7">
        <CircleCheck aria-hidden className="mt-1 size-5 shrink-0 text-ok" />
        {tk("app.doneBody", { name })}
      </p>
    </WizardDialog>
  );
}
