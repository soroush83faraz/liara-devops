"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Dialog, DialogContent, TypeToConfirm } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { useAction } from "../client";
import { ErrorNotice } from "./error-notice";

export type Reversibility = "yes" | "partly" | "no";

const REVERSIBLE_KEY = {
  yes: "approval.reversible",
  partly: "appConfig.op.partlyReversible",
  no: "approval.irreversible",
} as const;

export interface OpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will be done, in one line. */
  operation: string;
  /** Resource name (rendered LTR). */
  target: string;
  effect: string;
  risk: string;
  reversible: Reversibility;
  /** Cost line for billed operations. */
  cost?: ReactNode;
  /** When set, the user must type this exact name (tier 2/3). */
  typedName?: string;
  danger?: boolean;
  confirmLabel: string;
  /** Disables the confirm button of the one-click variant (invalid form). */
  confirmDisabled?: boolean;
  /** Unsaved input: the first attempt to close only warns, the second discards. */
  dirty?: boolean;
  /** Must throw on failure (the dialog then stays open and shows the error). */
  onConfirm: () => Promise<unknown>;
  /** Extra content shown above the summary (inputs, warnings). */
  children?: ReactNode;
}

/**
 * Every mutation dialog shows the same facts: operation, target, effect, risk, reversibility (and cost).
 * Tier 1 = one confirm button; tier 2/3 = the user types the resource name.
 * Mount it only while needed (`{open ? <Form/> : null}`) so form state, including secrets, dies on close.
 */
export function OpDialog(props: OpDialogProps) {
  const { open, onOpenChange, typedName, danger, confirmLabel, confirmDisabled, onConfirm, title, children, dirty } = props;
  const action = useAction();
  const [discardArmed, setDiscardArmed] = useState(false);
  const succeeded = useRef(false);

  const close = (next: boolean) => {
    if (!next) {
      if (dirty && !discardArmed && !succeeded.current && !action.pending) {
        setDiscardArmed(true);
        return;
      }
      action.reset();
      setDiscardArmed(false);
    }
    onOpenChange(next);
  };
  const confirm = async () => {
    await action.run(onConfirm);
    succeeded.current = true;
  };

  const body = (
    <div className="flex flex-col gap-4">
      {children}
      <OpSummary {...props} />
      {discardArmed ? (
        <p role="status" className="rounded-lg bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
          {t("appConfig.op.discardWarning")}
        </p>
      ) : null}
      {action.error ? <ErrorNotice error={action.error} /> : null}
    </div>
  );

  if (typedName) {
    return (
      <TypeToConfirm
        open={open}
        onOpenChange={close}
        name={typedName}
        title={title}
        danger={danger}
        confirmLabel={confirmLabel}
        onConfirm={confirm}
      >
        {body}
      </TypeToConfirm>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      {open ? (
        <DialogContent
          title={title}
          footer={
            <>
              <Button variant="secondary" onClick={() => close(false)} disabled={action.pending}>
                {t("common.cancel")}
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                loading={action.pending}
                disabled={confirmDisabled}
                onClick={() => {
                  void confirm().then(
                    () => close(false),
                    () => undefined,
                  );
                }}
              >
                {confirmLabel}
              </Button>
            </>
          }
        >
          {body}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function OpSummary({
  operation,
  target,
  effect,
  risk,
  reversible,
  cost,
}: Pick<OpDialogProps, "operation" | "target" | "effect" | "risk" | "reversible" | "cost">) {
  const rows: Array<{ label: string; value: ReactNode }> = [
    { label: t("approval.operation"), value: operation },
    {
      label: t("approval.target"),
      value: (
        <bdi dir="ltr" className="font-mono text-[0.9em]">
          {target}
        </bdi>
      ),
    },
    { label: t("approval.expectedEffect"), value: effect },
    { label: t("approval.risks"), value: risk },
    { label: t("approval.reversibility"), value: t(REVERSIBLE_KEY[reversible]) },
  ];
  if (cost) rows.push({ label: t("approval.cost"), value: cost });
  return (
    <dl className="divide-y divide-border rounded-lg border border-border bg-surface-muted/50 px-3">
      {rows.map((r) => (
        <div key={r.label} className="grid gap-0.5 py-2 text-sm leading-7 sm:grid-cols-[7rem_1fr] sm:gap-3">
          <dt className="text-muted">{r.label}</dt>
          <dd className="min-w-0 break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
