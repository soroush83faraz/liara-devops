"use client";

import { useId, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n/t";
import { matchesName } from "./confirm-match";
import { Button } from "./button";
import { Dialog, DialogContent } from "./dialog";
import { Input } from "./input";
import { TriangleAlert } from "lucide-react";

export interface TypeToConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The exact resource name the user must type. */
  name: string;
  title: ReactNode;
  description?: ReactNode;
  /** Destructive styling and warning line. */
  danger?: boolean;
  confirmLabel?: string;
  /** Extra content shown above the input (cost line, impact summary). */
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
}

/** Dialog body that keeps the confirm button disabled until the exact resource name is typed. */
export function TypeToConfirm({
  open,
  onOpenChange,
  name,
  title,
  description,
  danger,
  confirmLabel,
  children,
  onConfirm,
}: TypeToConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ConfirmBody
          name={name}
          title={title}
          description={description}
          danger={danger}
          confirmLabel={confirmLabel}
          onConfirm={onConfirm}
          onClose={() => onOpenChange(false)}
        >
          {children}
        </ConfirmBody>
      ) : null}
    </Dialog>
  );
}

function ConfirmBody({
  name,
  title,
  description,
  danger,
  confirmLabel,
  children,
  onConfirm,
  onClose,
}: Omit<TypeToConfirmProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const matches = matchesName(value, name);

  async function submit() {
    if (!matches || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await onConfirm();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogContent
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!matches}
            loading={pending}
            onClick={submit}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {danger ? (
          <p className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm leading-7 text-danger-ink">
            <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
            {t("approval.dangerWarning")}
          </p>
        ) : null}
        {children}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm leading-7">
            {t("approval.typeNameDescription")}{" "}
            <bdi dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono text-[0.9em] font-semibold">
              {name}
            </bdi>
          </label>
          <Input
            id={inputId}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={`${inputId}-status`}
            invalid={value.length > 0 && !matches}
            className="text-start font-mono"
          />
          <p id={`${inputId}-status`} role="status" aria-live="polite" className="min-h-6 text-xs leading-6 text-muted">
            {value.length === 0 ? "" : matches ? t("approval.typeNameMatch") : t("approval.typeNameMismatch")}
          </p>
          {failed ? (
            <p role="alert" className="text-sm leading-6 text-danger">
              {t("approval.confirmFailed")}
            </p>
          ) : null}
        </div>
      </form>
    </DialogContent>
  );
}
