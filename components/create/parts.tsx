"use client";

import { CircleCheck, CircleX, Receipt, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { Button, ErrorBanner, Field, Input, Select, Spinner } from "@/components/ui";
import { matchesName } from "@/components/ui/confirm-match";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatToman, type BalanceGate, type CostLine } from "@/lib/create/cost";
import type { ErrorKey } from "@/lib/create/errors";
import { type NetworkChoice, type SubmitState } from "@/lib/create/wizards";
import type { PlansResponse } from "@/lib/create/types";
import { validateNetworkName } from "@/lib/create/validators";
import { t, type TKey } from "@/lib/i18n/t";
import { AnimatedNumber, ease, spring } from "@/lib/ui/motion";
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
        <StepBody index={stepIndex ?? 0}>{children}</StepBody>
      </DialogContent>
    </Dialog>
  );
}

function StepHeader({ labels, index }: { labels: string[]; index: number }) {
  return (
    <div className="mb-5 flex flex-col gap-2.5">
      <p className="flex items-baseline gap-1.5 text-xs text-muted" aria-live="polite">
        {tk("common.stepOf", { current: index + 1, total: labels.length })}:{" "}
        <span className="text-sm font-semibold text-foreground">{labels[index]}</span>
      </p>
      <ol className="flex gap-1" aria-hidden>
        {labels.map((l, i) => (
          <li key={l} className="relative h-1 flex-1 overflow-hidden rounded-full bg-border">
            <span
              className="absolute inset-0 origin-right rounded-full bg-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ltr:origin-left"
              style={{ transform: `scaleX(${i <= index ? 1 : 0})`, transitionDelay: i === index ? "80ms" : "0ms" }}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

/*
 * Each step slides in from the direction of travel (RTL: forward arrives from the inline-end, i.e. the left) and
 * fades. The outgoing step is not kept around, so focus and form state never belong to two steps at once.
 */
function StepBody({ index, children }: { index: number; children: ReactNode }) {
  const [shown, setShown] = useState(index);
  const [dir, setDir] = useState(1);
  if (shown !== index) {
    setShown(index);
    setDir(index > shown ? 1 : -1);
  }
  return (
    <motion.div key={index} initial={{ opacity: 0, x: dir * -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.26, ease: ease.out }}>
      {children}
    </motion.div>
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
        "relative flex min-h-11 flex-col gap-1 rounded-md border p-3 transition-[border-color,background-color,box-shadow] duration-200",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
        checked ? "border-accent bg-accent-soft/60 shadow-[var(--glow-accent)]" : "border-border bg-surface hover:border-border-strong/60 hover:bg-surface-muted/60",
        disabled && "opacity-60 hover:border-border hover:bg-surface",
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
          {checked ? (
            <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.pop} className="mt-1 flex shrink-0">
              <CircleCheck aria-hidden className="size-4 text-accent" />
            </motion.span>
          ) : (
            badge
          )}
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

/** A dictionary sentence with its {amount} rendered as a tweening number (the rest of the sentence stays put). */
function AnimatedAmount({ template, amount, className }: { template: "cost.hourly" | "cost.monthly"; amount: number; className?: string }) {
  const [before = "", after = ""] = tk(template, { amount: "@@" }).split(/\u2068?@@\u2069?/);
  return (
    <span className={className}>
      {before}
      <AnimatedNumber value={amount} format={formatToman} />
      {after}
    </span>
  );
}

export function PriceLines({ hourly, monthly, animated = false }: { hourly: number; monthly: number; animated?: boolean }) {
  if (hourly === 0) return <span className="text-sm font-medium">{tk("cost.free")}</span>;
  if (animated) {
    return (
      <span className="flex flex-col gap-0.5">
        <AnimatedAmount template="cost.hourly" amount={hourly} className="text-lg font-bold" />
        <AnimatedAmount template="cost.monthly" amount={monthly} className="text-sm text-muted" />
      </span>
    );
  }
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
    <section aria-label={tk("cost.heading")} className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/60 p-3.5">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Receipt aria-hidden className="size-3.5" />
        {tk("cost.heading")}
      </h4>
      {cost ? <PriceLines hourly={cost.hourly} monthly={cost.monthly} animated /> : <p className="text-sm text-danger">{tk("cost.unknown")}</p>}
      {bundle?.displayPrice !== undefined ? (
        <p className="text-xs leading-6 text-muted">{tk("cost.bundleLine", { bundle: bundle.id, amount: formatToman(bundle.displayPrice) })}</p>
      ) : null}
      <p className="text-xs leading-6 text-muted">{tk("cost.estimateNote")}</p>
      {billed ? <p className="text-xs leading-6 text-muted">{tk("cost.billedFromCreation")}</p> : null}
      {balance.status === "team_unreadable" ? (
        <p role="alert" className="flex items-start gap-2 rounded-sm bg-danger-soft p-2 text-sm leading-7 text-danger-ink">
          <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
          {tk("cost.teamBalanceUnreadable")}
        </p>
      ) : balance.status === "unknown" ? (
        <p className="text-xs leading-6 text-muted">{tk("cost.balanceUnknown")}</p>
      ) : balance.status === "ok" ? (
        <p className="text-xs leading-6">{tk("cost.balance", { amount: formatToman(balance.balance) })}</p>
      ) : (
        <p role="alert" className="flex items-start gap-2 rounded-sm bg-danger-soft p-2 text-sm leading-7 text-danger-ink">
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
  const state = value.length === 0 ? "empty" : ok ? "match" : "mismatch";
  return (
    <div className="flex flex-col gap-1.5" data-typed-state={state}>
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
        className={cn("text-start font-mono transition-[border-color,box-shadow]", ok && "border-ok shadow-[0_0_0_3px_color-mix(in_oklab,var(--ok)_18%,transparent)]")}
      />
      <p
        id={`${id}-s`}
        role="status"
        aria-live="polite"
        className={cn("flex min-h-6 items-center gap-1.5 text-xs font-medium leading-6", state === "match" ? "text-ok" : state === "mismatch" ? "text-danger" : "text-muted")}
      >
        {state === "match" ? (
          <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring.pop} className="flex">
            <CircleCheck aria-hidden className="size-3.5" />
          </motion.span>
        ) : state === "mismatch" ? (
          <CircleX aria-hidden className="size-3.5" />
        ) : null}
        {state === "empty" ? "" : ok ? tk("typed.match") : tk("typed.mismatch")}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- success */

/** Creation succeeded: a check that strokes itself in over a soft ok surface (the wizard's one celebratory moment). */
export function DoneMessage({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.pop}
      className="flex items-start gap-3 rounded-md border border-ok/35 bg-ok-soft/50 p-3.5"
    >
      <span aria-hidden className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
        <span className="absolute inset-0 rounded-full border border-ok/50 animate-hl-ping [animation-iteration-count:2]" />
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.2 4.2L19 7" pathLength={100} className="hl-draw" />
        </svg>
      </span>
      <p className="pt-1 text-sm leading-7">{children}</p>
    </motion.div>
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

