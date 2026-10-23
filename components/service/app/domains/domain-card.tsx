"use client";

import { ArrowRightLeft, ChevronDown, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { fa } from "@/lib/i18n/fa";
import { runOp } from "@/lib/client/ops";
import { t } from "@/lib/i18n/t";
import type { DomainDto } from "@/lib/service/app-config/dto";
import { sslState } from "@/lib/service/app-config/domain-doctor";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";
import { DomainDoctor } from "./domain-doctor";
import { RedirectDialog } from "./redirect-dialog";
import { SslControl } from "./ssl-control";

/** «ACTIVE» -> «فعال». Values we have no Persian name for are shown raw (LTR) by the caller. */
function domainStatusLabel(raw: string | undefined): string | undefined {
  return raw ? (fa.appConfig.domains.statusNames as Record<string, string>)[raw.trim().toUpperCase()] : undefined;
}

export function DomainCard({ appName, domain }: { appName: string; domain: DomainDto }) {
  const done = useAfterMutation(appName);
  const [checked, setChecked] = useState<{ base: DomainDto; data: DomainDto } | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // A `check` result is fresher than the list entry it was based on; a changed list entry replaces it.
  const current = checked && checked.base === domain ? checked.data : domain;
  const ssl = sslState(current.certificatesStatus);
  const wildcard = current.name.startsWith("*.");
  const doctorId = `doctor-${domain.id || domain.name}`;

  return (
    <li className="rounded-xl border border-border bg-surface">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <bdi dir="ltr" className="break-all font-mono text-[15px] font-semibold">
            {current.name}
          </bdi>
          <div className="flex flex-wrap items-center gap-1.5">
            {current.status ? (
              <Badge tone="neutral" title={t("appConfig.domains.reportedStatus")}>
                {t("appConfig.domains.statusLabel")}: {domainStatusLabel(current.status) ?? <bdi dir="ltr">{current.status}</bdi>}
              </Badge>
            ) : null}
            <Badge tone={ssl === "active" ? "ok" : ssl === "pending" ? "warn" : "neutral"}>
              <ShieldCheck aria-hidden className="size-3" />
              {t(`appConfig.domains.ssl.badge.${ssl}`)}
            </Badge>
          </div>
        </div>

        {current.redirectTo ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <ArrowRightLeft aria-hidden className="size-4 shrink-0" />
            <span>
              {t("appConfig.domains.redirect.current", { status: current.redirectStatus ?? 301 })}{" "}
              <bdi dir="ltr" className="font-mono">
                {current.redirectTo}
              </bdi>
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={doctorOpen}
            aria-controls={doctorId}
            onClick={() => setDoctorOpen((v) => !v)}
          >
            <ChevronDown aria-hidden className={doctorOpen ? "size-4 rotate-180" : "size-4"} />
            {t("appConfig.domains.doctor.open")}
          </Button>
          <SslControl appName={appName} domain={current} />
          <Button variant="secondary" size="sm" onClick={() => setRedirecting(true)} disabled={!current.id}>
            <ArrowRightLeft aria-hidden className="size-4" />
            {t("appConfig.domains.redirect.action")}
          </Button>
          {wildcard ? null : (
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden className="size-4" />
              {t("common.delete")}
            </Button>
          )}
        </div>
        {wildcard ? <p className="text-xs leading-6 text-muted">{t("appConfig.domains.wildcardDeleteNote")}</p> : null}
      </div>

      {doctorOpen ? (
        <div id={doctorId} className="border-t border-border p-4">
          <DomainDoctor domain={current} onChecked={(data) => setChecked({ base: domain, data })} />
        </div>
      ) : null}

      {redirecting ? <RedirectDialog appName={appName} domain={current} onClose={() => setRedirecting(false)} /> : null}
      {deleting ? (
        <OpDialog
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(false);
          }}
          title={t("appConfig.domains.delete.title")}
          operation={t("appConfig.domains.delete.operation")}
          target={current.name}
          effect={t("appConfig.domains.delete.effect")}
          risk={t("appConfig.domains.delete.risk")}
          reversible="no"
          typedName={current.name}
          danger
          confirmLabel={t("appConfig.domains.delete.confirm")}
          onConfirm={async () => {
            await runOp({ params: { type: "delete_domain", domain: current.name }, typedName: current.name });
            done(t("appConfig.domains.delete.toast"));
          }}
        />
      ) : null}
    </li>
  );
}
