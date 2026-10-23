"use client";

import { CircleCheck, Network } from "lucide-react";
import { useReducer, useRef } from "react";
import { Button } from "@/components/ui";
import { errorKeyFor, toErrLike } from "@/lib/create/errors";
import { openAppDialog, openDbDialog } from "@/lib/create/store";
import { useAfterCreate, usePlans } from "@/lib/create/use-plans";
import { initialNetworkState, networkFormError, networkReducer } from "@/lib/create/wizards";
import { runOp } from "@/lib/client/ops";
import { matchesName } from "@/components/ui/confirm-match";
import { Field, Input } from "@/components/ui";
import { NavFooter, SubmitError, TypedField, WizardDialog, tk } from "./parts";

export function NetworkWizard({ onClose }: { onClose: () => void }) {
  const [s, dispatch] = useReducer(networkReducer, undefined, initialNetworkState);
  const plansQ = usePlans();
  const afterCreate = useAfterCreate();
  const inflight = useRef(false);
  const existing = plansQ.data?.networks.map((n) => n.name) ?? [];
  const busy = s.submit.phase === "pending";
  const nameError = s.name ? networkFormError(s.name, existing) : null;

  async function submit() {
    if (inflight.current || !matchesName(s.typed, s.name)) return;
    inflight.current = true;
    dispatch({ type: "submit_start" });
    try {
      await runOp({ params: { type: "create_network", name: s.name }, typedName: s.typed });
      await afterCreate();
      dispatch({ type: "submit_success" });
    } catch (e) {
      const err = toErrLike(e);
      dispatch({ type: "submit_error", errorKey: errorKeyFor(err, "create"), retryAfterSec: err.retryAfterSec });
    } finally {
      inflight.current = false;
    }
  }

  if (s.step === "done") {
    return (
      <WizardDialog title={tk("network.doneTitle")} onClose={onClose} footer={<Button onClick={onClose}>{tk("network.finish")}</Button>}>
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2 text-sm leading-7">
            <CircleCheck aria-hidden className="mt-1 size-5 shrink-0 text-ok" />
            {tk("network.doneBody", { name: s.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => openAppDialog(s.name)}>
              {tk("network.createApp")}
            </Button>
            <Button variant="secondary" onClick={() => openDbDialog(s.name)}>
              {tk("network.createDb")}
            </Button>
          </div>
        </div>
      </WizardDialog>
    );
  }

  const labels = [tk("network.stepName"), tk("network.stepConfirm")];
  const confirm = s.step === "confirm";
  return (
    <WizardDialog
      title={tk("network.title")}
      stepLabels={labels}
      stepIndex={confirm ? 1 : 0}
      busy={busy}
      onClose={onClose}
      footer={
        confirm ? (
          <NavFooter onCancel={onClose} onBack={() => dispatch({ type: "back" })} onNext={() => void submit()} nextLabel={tk("network.submit")} nextDisabled={!matchesName(s.typed, s.name)} busy={busy} />
        ) : (
          <NavFooter onCancel={onClose} onNext={() => dispatch({ type: "next", existingNames: existing })} nextDisabled={!s.name || nameError !== null} />
        )
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2 rounded-xl bg-accent-soft p-3 text-accent-ink">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Network aria-hidden className="size-4" />
            {tk("network.explainTitle")}
          </h4>
          <p className="text-sm leading-7">{tk("network.explain")}</p>
          <p className="text-xs leading-6">{tk("network.explainDb")}</p>
          <p className="text-xs font-medium leading-6">{tk("network.immutable")}</p>
        </section>
        {plansQ.data?.flags.privateNetworkFeature === false ? <p className="text-sm leading-7 text-warn-ink">{tk("network.notEnabled")}</p> : null}
        {confirm ? (
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold">{tk("network.reviewTitle")}</h4>
            <p className="text-sm leading-7">{tk("network.reviewBody", { name: s.name })}</p>
            <p className="text-xs text-muted">{tk("network.free")}</p>
            <TypedField label={tk("typed.label")} name={s.name} value={s.typed} onChange={(typed) => dispatch({ type: "set_typed", typed })} disabled={busy} />
            <SubmitError submit={s.submit} />
          </div>
        ) : (
          <Field
            label={tk("network.nameLabel")}
            hint={tk("network.nameHint")}
            error={nameError ? tk(nameError === "duplicate" ? "validation.duplicate" : `validation.${nameError === "charset" ? "networkCharset" : nameError}`) : undefined}
          >
            {(p) => (
              <Input {...p} dir="ltr" autoFocus autoComplete="off" spellCheck={false} value={s.name} onChange={(e) => dispatch({ type: "set_name", name: e.target.value })} className="text-start font-mono" />
            )}
          </Field>
        )}
      </div>
    </WizardDialog>
  );
}
