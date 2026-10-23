"use client";

import { ChevronDown, ListFilter } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ObsServiceDto } from "@/lib/observability/types";
import { t } from "@/lib/i18n/t";
import { ease } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

/** Include/hide toggles. A disclosure with native checkboxes: keyboard operable and announced by every screen reader. */
export function ServiceFilter({
  services,
  hidden,
  onToggle,
  onShowAll,
  colorOf,
}: {
  services: readonly ObsServiceDto[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string, visible: boolean) => void;
  onShowAll: () => void;
  colorOf?: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const shown = services.filter((s) => !hidden.has(s.id)).length;
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)} className="self-start">
        <ListFilter aria-hidden className="size-4" />
        {t("observability.controls.services")}
        <span className={cn("rounded-full px-1.5 text-xs", hidden.size > 0 ? "bg-accent-soft text-accent-ink" : "text-muted")}>
          {t("observability.controls.servicesSummary", { shown, total: services.length })}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 text-muted transition-transform duration-200", open && "rotate-180")} />
      </Button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="panel"
            id={panelId}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: ease.out }}
            className="rounded-md border border-border bg-surface p-3 shadow-[var(--shadow-soft)]"
          >
            <p className="mb-2 px-1 text-xs leading-6 text-muted">{t("observability.controls.servicesHelp")}</p>
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((s) => {
                const on = !hidden.has(s.id);
                return (
                  <li key={s.id}>
                    <label
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm border px-2.5 text-sm transition-colors md:min-h-9",
                        on ? "border-border bg-surface hover:bg-surface-muted" : "border-dashed border-border bg-transparent text-muted hover:bg-surface-muted",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-[var(--accent)]"
                        checked={on}
                        onChange={(e) => onToggle(s.id, e.target.checked)}
                        aria-label={t("observability.controls.toggleService", { name: s.name })}
                      />
                      {colorOf ? (
                        <span aria-hidden className={cn("h-1 w-3 shrink-0 rounded-full transition-opacity", !on && "opacity-30")} style={{ background: colorOf(s.id) }} />
                      ) : null}
                      <bdi dir="ltr" className={cn("min-w-0 truncate", !on && "line-through decoration-muted/60")}>
                        {s.name}
                      </bdi>
                    </label>
                  </li>
                );
              })}
            </ul>
            {hidden.size > 0 ? (
              <Button variant="ghost" size="sm" className="mt-2" onClick={onShowAll}>
                {t("observability.controls.showAll")}
              </Button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
