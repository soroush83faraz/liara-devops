"use client";

import { ListFilter } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ObsServiceDto } from "@/lib/observability/types";
import { t } from "@/lib/i18n/t";

/** Include/hide toggles. A disclosure with native checkboxes: keyboard operable and announced by every screen reader. */
export function ServiceFilter({
  services,
  hidden,
  onToggle,
  onShowAll,
}: {
  services: readonly ObsServiceDto[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string, visible: boolean) => void;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const shown = services.filter((s) => !hidden.has(s.id)).length;
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)} className="self-start">
        <ListFilter aria-hidden className="size-4" />
        {t("observability.controls.services")}
        <span className="text-muted">{t("observability.controls.servicesSummary", { shown, total: services.length })}</span>
      </Button>
      {open ? (
        <div id={panelId} className="rounded-xl border border-border bg-surface p-3">
          <p className="mb-2 text-xs leading-6 text-muted">{t("observability.controls.servicesHelp")}</p>
          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <li key={s.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-muted md:min-h-9">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={!hidden.has(s.id)}
                    onChange={(e) => onToggle(s.id, e.target.checked)}
                    aria-label={t("observability.controls.toggleService", { name: s.name })}
                  />
                  <bdi dir="ltr" className="min-w-0 truncate">
                    {s.name}
                  </bdi>
                </label>
              </li>
            ))}
          </ul>
          {hidden.size > 0 ? (
            <Button variant="ghost" size="sm" className="mt-2" onClick={onShowAll}>
              {t("observability.controls.showAll")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
