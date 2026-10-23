"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button, ErrorBanner, Field, Input, Select, Spinner } from "@/components/ui";
import { matchesName } from "@/components/ui/confirm-match";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatToman, type BalanceGate, type CostLine } from "@/lib/create/cost";
import type { ErrorKey } from "@/lib/create/errors";
import { type NetworkChoice, type SubmitState } from "@/lib/create/wizards";
import type { PlansResponse } from "@/lib/create/types";
import { validateNetworkName } from "@/lib/create/validators";
import { t, type TKey } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

export const tk = (key: string, params?: Record<string, string | number>) => t(`createFlow.${key}` as TKey, params);

/* ------------------------------------------------------------------ frame */

export function WizardDialog({
  title,
  description,
  stepLabels,
  stepIndex,
  busy,
  onClose,
  footer,
  children,
}: {
  title: string;
  description?: string;
  stepLabels?: string[];
  stepIndex?: number;
  busy?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title={title}
        description={description}
        size="lg"
        footer={footer}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {stepLabels && stepIndex !== undefined ? <StepHeader labels={stepLabels} index={stepIndex} /> : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}

function StepHeader({ labels, index }: { labels: string[]; index: number }) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <p className="text-xs text-muted" aria-live="polite">
        {tk("common.stepOf", { current: index + 1, total: labels.length })}: <span className="font-medium text-foreground">{labels[index]}</span>
      </p>
      <ol className="flex gap-1.5" aria-hidden>
        {labels.map((l, i) => (
          <li key={l} className={cn("h-1.5 flex-1 rounded-full", i <= index ? "bg-accent" : "bg-border")} />
        ))}
      </ol>
    </div>
  );
}

export function NavFooter({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  busy,
  onCancel,
  nextVariant,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  onCancel: () => void;
  nextVariant?: "primary" | "danger";
}) {
  return (
    <>
      {onBack ? (
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          {tk("common.back")}
        </Button>
      ) : (
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {tk("common.cancel")}
        </Button>
      )}
      {onNext ? (
        <Button variant={nextVariant ?? "primary"} onClick={onNext} disabled={nextDisabled} loading={busy}>
          {nextLabel ?? tk("common.next")}
        </Button>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ option cards */

/** Native radio inside a card: keyboard (arrow keys / space) and screen readers work for free. */
export function OptionCard({
  name,
  value,
  checked,
  onChange,
  disabled,
  title,
  subtitle,
  children,
  badge,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-11 flex-col gap-1 rounded-xl border p-3 transition-colors",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
        checked ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-muted",
        disabled && "opacity-60 hover:bg-surface",
      )}
    >
      <label className={cn("flex flex-col gap-1", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
        <input
          type="radio"
          className="sr-only"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => onChange(value)}
        />
        <span className="flex items-start justify-between gap-2">
          <span className="text-[15px] font-semibold leading-7">{title}</span>
          {checked ? <CircleCheck aria-hidden className="mt-1 size-4 shrink-0 text-accent" /> : badge}
        </span>
        {subtitle ? <span className="text-xs leading-6 text-muted">{subtitle}</span> : null}
      </label>
      {children}
    </div>
  );
}

export function CardGrid({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- cost block */

export function PriceLines({ hourly, monthly }: { hourly: number; monthly: number }) {
  if (hourly === 0) return <span className="text-sm font-medium">{tk("cost.free")}</span>;
  return (
    <span className="flex flex-col text-sm leading-6">
      <span className="font-medium">{tk("cost.hourly", { amount: formatToman(hourly) })}</span>
      <span className="text-muted">{tk("cost.monthly", { amount: formatToman(monthly) })}</span>
    </span>
  );
}

export function CostBlock({
  cost,
  balance,
  bundle,
  billed = true,
}: {
  cost: CostLine | null;
  balance: BalanceGate;
  bundle?: { id: string; displayPrice?: number };
  billed?: boolean;
}) {
  return (
    <section aria-label={tk("cost.heading")} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3">
      <h4 className="text-sm font-semibold">{tk("cost.heading")}</h4>
      {cost ? <PriceLines hourly={cost.hourly} monthly={cost.monthly} /> : <p className="text-sm text-danger">{tk("cost.unknown")}</p>}
      {bundle?.displayPrice !== undefined ? (
        <p className="text-xs leading-6 text-muted">{tk("cost.bundleLine", { bundle: bundle.id, amount: formatToman(bundle.displayPrice) })}</p>
      ) : null}
      <p className="text-xs leading-6 text-muted">{tk("cost.estimateNote")}</p>
      {billed ? <p className="text-xs leading-6 text-muted">{tk("cost.billedFromCreation")}</p> : null}
      {balance.status === "team_unreadable" ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft p-2 text-sm leading-7 text-danger-ink">
          <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
          {tk("cost.teamBalanceUnreadable")}
        </p>
      ) : balance.status === "unknown" ? (
        <p className="text-xs leading-6 text-muted">{tk("cost.balanceUnknown")}</p>
      ) : balance.status === "ok" ? (
        <p className="text-xs leading-6">{tk("cost.balance", { amount: formatToman(balance.balance) })}</p>
      ) : (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft p-2 text-sm leading-7 text-danger-ink">
          <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
          {tk("cost.insufficient", { balance: formatToman(balance.balance), needed: formatToman(balance.needed) })}
        </p>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- typed confirm */

export function TypedField({ label, name, value, onChange, disabled }: { label: string; name: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  const ok = matchesName(value, name);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm leading-7">
        {label}{" "}
        <bdi dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono text-[0.9em] font-semibold">
          {name}
        </bdi>
      </label>
      <Input
        id={id}
        dir="ltr"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        invalid={value.length > 0 && !ok}
        aria-describedby={`${id}-s`}
        className="text-start font-mono"
      />
      <p id={`${id}-s`} role="status" aria-live="polite" className="min-h-6 text-xs leading-6 text-muted">
        {value.length === 0 ? "" : ok ? tk("typed.match") : tk("typed.mismatch")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ errors */

export function SubmitError({ submit }: { submit: SubmitState }) {
  if (submit.phase !== "error") return null;
  return (
    <ErrorBanner
      message={
        <>
          {tk(`errors.${submit.errorKey satisfies ErrorKey}`)}
          {submit.retryAfterSec ? <> {tk("common.retryIn", { seconds: submit.retryAfterSec })}</> : null}
        </>
      }
    />
  );
}

export function PlansGate({ query, children }: { query: { isPending: boolean; isError: boolean; refetch: () => unknown; data?: PlansResponse }; children: (plans: PlansResponse) => ReactNode }) {
  if (query.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted">
        <Spinner /> {tk("common.loadingPlans")}
      </p>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorBanner message={tk("common.plansFailed")} onRetry={() => void query.refetch()} retryLabel={tk("common.retry")} />;
  }
  return <>{children(query.data)}</>;
}

/* ------------------------------------------------------------ network pick */

export function NetworkPicker({
  plans,
  value,
  onChange,
  disabled,
}: {
  plans: PlansResponse;
  value: NetworkChoice;
  onChange: (c: NetworkChoice) => void;
  disabled?: boolean;
}) {
  const group = useId();
  const unavailable = plans.partial.includes("networks");
  const newName = value.mode === "new" ? value.name : "";
  const newError = value.mode === "new" && newName ? (validateNetworkName(newName) ?? (plans.networks.some((n) => n.name === newName) ? "duplicate" : null)) : null;
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">{tk("netPicker.legend")}</legend>
      <p className="text-xs leading-6 text-warn-ink">{tk("netPicker.immutable")}</p>
      {unavailable ? <p className="text-xs leading-6 text-muted">{tk("netPicker.unavailable")}</p> : null}
      <div role="radiogroup" aria-label={tk("netPicker.legend")} className="grid gap-2">
        <OptionCard name={group} value="none" checked={value.mode === "none"} onChange={() => onChange({ mode: "none" })} title={tk("netPicker.none")} subtitle={tk("netPicker.noneHint")} />
        {!unavailable ? (
          <OptionCard
            name={group}
            value="existing"
            checked={value.mode === "existing"}
            disabled={plans.networks.length === 0}
            onChange={() => onChange({ mode: "existing", name: plans.networks[0]?.name ?? "" })}
            title={tk("netPicker.existing")}
            subtitle={plans.networks.length === 0 ? tk("netPicker.noneExisting") : undefined}
          >
            {value.mode === "existing" ? (
              <Select
                aria-label={tk("netPicker.existing")}
                value={value.name}
                onValueChange={(name) => onChange({ mode: "existing", name })}
                placeholder={tk("netPicker.existingPlaceholder")}
                options={plans.networks.map((n) => ({ value: n.name, label: n.name }))}
              />
            ) : null}
          </OptionCard>
        ) : null}
        {!unavailable ? (
          <OptionCard name={group} value="new" checked={value.mode === "new"} onChange={() => onChange({ mode: "new", name: "" })} title={tk("netPicker.createNew")}>
            {value.mode === "new" ? (
              <Field label={tk("netPicker.newName")} hint={tk("netPicker.newHint")} error={newError ? tk(newError === "duplicate" ? "validation.duplicate" : `validation.${newError === "charset" ? "networkCharset" : newError}`) : undefined}>
                {(p) => (
                  <Input {...p} dir="ltr" autoComplete="off" spellCheck={false} value={newName} onChange={(e) => onChange({ mode: "new", name: e.target.value.trim() })} className="text-start font-mono" />
                )}
              </Field>
            ) : null}
          </OptionCard>
        ) : null}
      </div>
    </fieldset>
  );
}

