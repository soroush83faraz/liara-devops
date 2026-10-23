"use client";

import { Check } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { faNumber, faPrice } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { PlanOption } from "@/lib/setup/sizing";
import { spring } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

export function PlanCard({ plan, badge, warn, name, checked, onSelect }: { plan: PlanOption; badge?: string; warn?: string; name: string; checked: boolean; onSelect: () => void }) {
  return (
    <label
      className={cn(
        "relative flex min-h-11 cursor-pointer flex-col gap-1.5 rounded-md border p-3.5 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent active:scale-[0.99]",
        checked ? "border-accent bg-accent-soft/60 shadow-[var(--glow-accent)]" : "border-border bg-surface hover:border-border-strong/60 hover:bg-surface-muted/60",
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onSelect} />
      <span
        aria-hidden
        className={cn(
          "absolute end-3 top-3 flex size-5 items-center justify-center rounded-full border transition-colors duration-200",
          checked ? "border-accent bg-accent text-accent-foreground" : "border-border-strong/50 bg-surface",
        )}
      >
        {checked ? (
          <motion.span initial={{ scale: 0.3 }} animate={{ scale: 1 }} transition={spring.pop} className="flex">
            <Check className="size-3" strokeWidth={3.5} />
          </motion.span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-2 pe-7">
        <bdi dir="ltr" className="font-mono text-sm font-semibold">{plan.id}</bdi>
        {badge ? <Badge tone="accent">{badge}</Badge> : null}
        {warn ? <Badge tone="warn">{warn}</Badge> : null}
      </span>
      <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs leading-6 text-muted">
        {plan.ramGb !== undefined ? <span>{t("setupFlow.choices.ram", { value: faNumber(plan.ramGb) })}</span> : null}
        {plan.cpu !== undefined ? <span>{t("setupFlow.choices.cpu", { value: faNumber(plan.cpu) })}</span> : null}
      </span>
      <span className={cn("text-[15px] font-semibold tabular-nums", checked ? "text-accent-ink" : "text-foreground")}>
        {t("setupFlow.choices.priceMonth", { price: faPrice(plan.pricePerMonth) })}
      </span>
    </label>
  );
}

/** The recommended plan plus one smaller and one bigger alternative; "show all" reveals the rest. */
export function PlanPicker({
  name,
  plans,
  value,
  onChange,
  recommendedId,
  smallerId,
  biggerId,
  belowNeed,
}: {
  name: string;
  plans: PlanOption[];
  value: string;
  onChange: (id: string) => void;
  recommendedId?: string;
  smallerId?: string;
  biggerId?: string;
  belowNeed?: boolean;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...plans].sort((a, b) => a.pricePerHour - b.pricePerHour);
  const featured = new Set([recommendedId, smallerId, biggerId, value].filter(Boolean));
  const shown = all ? sorted : sorted.filter((p) => featured.has(p.id));
  if (plans.length === 0) return <p className="text-sm text-danger">{t("setupFlow.choices.noPlans")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {shown.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            name={name}
            checked={value === p.id}
            onSelect={() => onChange(p.id)}
            badge={p.id === recommendedId ? t("setupFlow.choices.recommended") : p.id === smallerId ? t("setupFlow.choices.smaller") : p.id === biggerId ? t("setupFlow.choices.bigger") : undefined}
            warn={p.id === recommendedId && belowNeed ? t("setupFlow.choices.belowNeed") : p.id === smallerId ? t("setupFlow.choices.belowNeed") : undefined}
          />
        ))}
      </div>
      {sorted.length > shown.length || all ? (
        <button type="button" className="min-h-11 self-start rounded-sm px-1 text-sm font-medium text-accent-ink underline-offset-4 hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? t("common.hide") : `${t("common.show")} (${faNumber(sorted.length)})`}
        </button>
      ) : null}
    </div>
  );
}
