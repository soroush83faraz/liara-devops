"use client";

import { TriangleAlert } from "lucide-react";
import { useReducer, useRef } from "react";
import { Badge, Button, Field, Input, Select, Switch } from "@/components/ui";
import { runOp } from "@/lib/client/ops";
import { DB_ENGINES, type DbEngine } from "@/lib/contracts/common";
import { formatToman } from "@/lib/create/cost";
import { errorKeyFor, toErrLike } from "@/lib/create/errors";
import { formatCores, formatRam, formatDisk } from "@/lib/create/format";
import { dbPlansFor, isSelectable } from "@/lib/create/plans";
import { useAfterCreate, usePlans } from "@/lib/create/use-plans";
import type { PlansResponse } from "@/lib/create/types";
import { validateDbName } from "@/lib/create/validators";
import {
  DB_STEPS,
  canAdvanceDb,
  dbEngines,
  dbReducer,
  dbReviewGate,
  initialDbState,
  networkNameOf,
  type DbWizardState,
} from "@/lib/create/wizards";
import { dbServiceId } from "@/lib/canvas/service-id";
import { useShellStore } from "@/components/shell/shell-store";
import { CardGrid, CostBlock, NavFooter, NetworkPicker, OptionCard, PlansGate, PriceLines, SubmitError, TypedField, DoneMessage, WizardDialog, tk } from "./parts";

const engineLabel = (e: string) => {
  const v = tk(`engines.${e}.label`) as string;
  return v.startsWith("createFlow.") ? e : v;
};
const engineDesc = (e: string) => {
  const v = tk(`engines.${e}.desc`) as string;
  return v.startsWith("createFlow.") ? undefined : v;
};

type Dispatch = (a: Parameters<typeof dbReducer>[1]) => void;

export function DbWizard({ onClose, network }: { onClose: () => void; network?: string }) {
  const [s, dispatch] = useReducer(dbReducer, network, initialDbState);
  const plansQ = usePlans();
  const afterCreate = useAfterCreate();
  const inflight = useRef(false);
  const busy = s.submit.phase === "pending";

  async function submit(plans: PlansResponse) {
    if (inflight.current || !dbReviewGate(s, plans).canSubmit) return;
    inflight.current = true;
    dispatch({ type: "submit_start" });
    try {
      if (s.network.mode === "new" && !s.networkCreated) {
        await runOp({ params: { type: "create_network", name: s.network.name }, typedName: s.typedNetwork });
        dispatch({ type: "stage_network_done" });
      }
      await runOp({
        params: {
          type: "create_db",
          name: s.name,
          engine: s.engine as DbEngine,
          version: s.version!,
          planId: s.planId!,
          ...(s.bundlePlanId ? { bundlePlanId: s.bundlePlanId } : {}),
          ...(networkNameOf(s.network) ? { network: networkNameOf(s.network) } : {}),
          publicNetwork: s.publicNetwork,
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

  if (s.step === "done") return <Done name={s.name} onClose={onClose} />;

  const labels = DB_STEPS.map((k) => tk(`db.steps.${k}`));
  const data = plansQ.data;
  const back = s.step === "engine" ? undefined : () => dispatch({ type: "back" });
  const footer = !data ? (
    <NavFooter onCancel={onClose} />
  ) : s.step === "review" ? (
    <NavFooter onCancel={onClose} onBack={back} onNext={() => void submit(data)} nextLabel={busy ? (s.submit.phase === "pending" && s.submit.stage === "network" ? tk("common.creatingNetwork") : tk("common.creating")) : tk("db.submit")} nextDisabled={!dbReviewGate(s, data).canSubmit} busy={busy} />
  ) : (
    <NavFooter onCancel={onClose} onBack={back} onNext={() => dispatch({ type: "next", plans: data })} nextDisabled={!canAdvanceDb(s, data)} />
  );

  return (
    <WizardDialog title={tk("db.title")} stepLabels={labels} stepIndex={DB_STEPS.indexOf(s.step)} busy={busy} onClose={onClose} footer={footer}>
      <PlansGate query={plansQ}>
        {(plans) => (
          <div className="flex flex-col gap-4">
            {s.step === "engine" ? <EngineStep s={s} plans={plans} dispatch={dispatch} /> : null}
            {s.step === "plan" ? <PlanStep s={s} plans={plans} dispatch={dispatch} /> : null}
            {s.step === "settings" ? <SettingsStep s={s} plans={plans} dispatch={dispatch} /> : null}
            {s.step === "review" ? <Review s={s} plans={plans} dispatch={dispatch} /> : null}
          </div>
        )}
      </PlansGate>
    </WizardDialog>
  );
}

function EngineStep({ s, plans, dispatch }: { s: DbWizardState; plans: PlansResponse; dispatch: Dispatch }) {
  const engines = dbEngines(plans, DB_ENGINES);
  const versions = (s.engine && plans.dbVersions[s.engine]) || [];
  if (engines.length === 0) return <p className="text-sm text-danger">{tk("db.noEngines")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">{tk("db.engineTitle")}</h4>
        <CardGrid label={tk("db.engineTitle")}>
          {engines.map((e) => (
            <OptionCard key={e} name="engine" value={e} checked={s.engine === e} onChange={(engine) => dispatch({ type: "set_engine", engine, plans })} title={<bdi dir="ltr">{engineLabel(e)}</bdi>} subtitle={engineDesc(e)} />
          ))}
        </CardGrid>
      </div>
      {s.engine ? (
        <Field label={tk("db.versionLabel")}>
          {(p) => <Select {...p} value={s.version} onValueChange={(version) => dispatch({ type: "set_version", version })} options={versions.map((v) => ({ value: v.value, label: v.label }))} />}
        </Field>
      ) : null}
    </div>
  );
}

function PlanStep({ s, plans, dispatch }: { s: DbWizardState; plans: PlansResponse; dispatch: Dispatch }) {
  const list = dbPlansFor(plans, s.engine);
  const bundles = s.planId ? (plans.dbBundlePlans[s.planId] ?? []) : [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">{tk("db.planTitle")}</h4>
        <p className="text-xs leading-6 text-muted">{tk("db.planHint")}</p>
        {plans.filtered.dbs ? <p className="text-xs leading-6 text-muted">{tk("common.planFiltered")}</p> : null}
        {list.length === 0 ? <p className="text-sm text-danger">{tk("common.noPlans")}</p> : null}
        <CardGrid label={tk("db.planTitle")}>
          {list.map((p) => {
            const specs = [formatRam(p.ramMb) && tk("plan.ram", { value: formatRam(p.ramMb)! }), formatCores(p.cpu) && tk("plan.cpu", { value: formatCores(p.cpu)! }), formatDisk(p.volumeGb) && tk("plan.disk", { value: formatDisk(p.volumeGb)! })].filter(Boolean).join(" · ");
            return (
              <OptionCard key={p.id} name="dbplan" value={p.id} checked={s.planId === p.id} disabled={!isSelectable(p)} onChange={(planId) => dispatch({ type: "set_plan", planId, plans })} title={<bdi dir="ltr" className="font-mono">{p.id}</bdi>} subtitle={specs}>
                {p.hourlyToman !== undefined && p.monthlyToman !== undefined ? <PriceLines hourly={p.hourlyToman} monthly={p.monthlyToman} /> : <span className="text-xs text-danger">{tk("common.priceUnknown")}</span>}
              </OptionCard>
            );
          })}
        </CardGrid>
      </div>
      {bundles.length > 1 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{tk("db.bundleTitle")}</h4>
          <CardGrid label={tk("db.bundleTitle")}>
            {bundles.map((b) => (
              <OptionCard key={b.id} name="dbbundle" value={b.id} checked={s.bundlePlanId === b.id} onChange={(bundlePlanId) => dispatch({ type: "set_bundle", bundlePlanId })} title={<bdi dir="ltr" className="font-mono">{b.label}</bdi>} subtitle={b.displayPrice !== undefined ? tk("cost.bundleCard", { amount: formatToman(b.displayPrice) }) : undefined} />
            ))}
          </CardGrid>
        </div>
      ) : null}
    </div>
  );
}

function SettingsStep({ s, plans, dispatch }: { s: DbWizardState; plans: PlansResponse; dispatch: Dispatch }) {
  const code = s.name ? validateDbName(s.name) : null;
  return (
    <div className="flex flex-col gap-5">
      <Field label={tk("db.nameLabel")} hint={tk("db.nameHint")} error={code ? tk(`validation.${code}`) : undefined}>
        {(p) => <Input {...p} dir="ltr" autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} value={s.name} onChange={(e) => dispatch({ type: "set_name", name: e.target.value })} className="text-start font-mono" />}
      </Field>
      <NetworkPicker plans={plans} value={s.network} onChange={(network) => dispatch({ type: "set_network", network })} />
      <div className="flex flex-col gap-2">
        <Switch label={tk("db.publicLabel")} description={tk("db.publicHint")} checked={s.publicNetwork} onCheckedChange={(value) => dispatch({ type: "set_public", value })} />
        {s.publicNetwork ? (
          <div className="flex flex-col gap-2 rounded-md border border-warn/40 bg-warn-soft p-3 text-warn-ink">
            <p className="flex items-start gap-2 text-sm leading-7">
              <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
              {tk("db.publicWarn")}
            </p>
            <Switch label={tk("db.publicAck")} checked={s.publicAck} onCheckedChange={(value) => dispatch({ type: "set_public_ack", value })} />
          </div>
        ) : null}
      </div>
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

function Review({ s, plans, dispatch }: { s: DbWizardState; plans: PlansResponse; dispatch: Dispatch }) {
  const gate = dbReviewGate(s, plans);
  const busy = s.submit.phase === "pending";
  const bundle = s.planId ? plans.dbBundlePlans[s.planId]?.find((b) => b.id === s.bundlePlanId) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <h4 className="text-sm font-semibold">{tk("db.reviewTitle")}</h4>
      <dl className="divide-y divide-border rounded-md border border-border px-3">
        <Row k={tk("db.summaryName")}><bdi dir="ltr" className="font-mono">{s.name}</bdi></Row>
        <Row k={tk("db.summaryEngine")}><bdi dir="ltr">{engineLabel(s.engine ?? "")}</bdi></Row>
        <Row k={tk("db.summaryVersion")}><bdi dir="ltr" className="font-mono">{s.version}</bdi></Row>
        <Row k={tk("db.summaryPlan")}><bdi dir="ltr" className="font-mono">{s.planId}</bdi></Row>
        {bundle ? <Row k={tk("db.summaryBundle")}><bdi dir="ltr" className="font-mono">{bundle.id}</bdi></Row> : null}
        <Row k={tk("db.summaryNetwork")}>{s.network.mode === "none" ? tk("common.noNetwork") : <bdi dir="ltr" className="font-mono">{s.network.name}</bdi>}{s.network.mode === "new" ? <Badge tone="accent" className="ms-2">{tk("netPicker.createNew")}</Badge> : null}</Row>
        <Row k={tk("db.summaryPublic")}>{s.publicNetwork ? <Badge tone="warn"><TriangleAlert aria-hidden className="size-3.5" />{tk("db.publicOn")}</Badge> : tk("db.publicOff")}</Row>
      </dl>
      <CostBlock cost={gate.cost} balance={gate.balance} bundle={bundle} />
      <Switch label={tk("common.iUnderstand")} checked={s.ack} onCheckedChange={(ack) => dispatch({ type: "set_ack", ack })} disabled={busy} />
      {s.network.mode === "new" && !s.networkCreated ? <TypedField label={tk("typed.networkLabel")} name={s.network.name} value={s.typedNetwork} onChange={(typed) => dispatch({ type: "set_typed_network", typed })} disabled={busy} /> : null}
      <TypedField label={tk("typed.label")} name={s.name} value={s.typedName} onChange={(typed) => dispatch({ type: "set_typed_name", typed })} disabled={busy} />
      <SubmitError submit={s.submit} />
    </div>
  );
}

function Done({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <WizardDialog
      title={tk("db.doneTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tk("db.finish")}
          </Button>
          <Button
            onClick={() => {
              useShellStore.getState().openService(dbServiceId(name));
              onClose();
            }}
          >
            {tk("db.openPanel")}
          </Button>
        </>
      }
    >
      <DoneMessage>{tk("db.doneBody", { name })}</DoneMessage>
    </WizardDialog>
  );
}
