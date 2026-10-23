"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { postJson } from "@/lib/service/app-config/client";
import type { DomainDto } from "@/lib/service/app-config/dto";
import { validateRedirectTarget, type RedirectStatus } from "@/lib/service/app-config/domain-doctor";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";

/** Sets a 301/302 redirect for the whole domain. The warning is part of the dialog, not a tooltip. */
export function RedirectDialog({ appName, domain, onClose }: { appName: string; domain: DomainDto; onClose: () => void }) {
  const done = useAfterMutation(appName);
  const [target, setTarget] = useState(domain.redirectTo ?? "");
  const [status, setStatus] = useState<RedirectStatus>(domain.redirectStatus === 302 ? 302 : 301);
  const check = validateRedirectTarget(target, domain.name);
  const invalid = target.trim() !== "" && !check.ok;

  return (
    <OpDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t("appConfig.domains.redirect.title")}
      operation={t("appConfig.domains.redirect.operation", { status })}
      target={domain.name}
      effect={t("appConfig.domains.redirect.effect")}
      risk={t("appConfig.domains.redirect.risk")}
      reversible="partly"
      confirmLabel={t("appConfig.domains.redirect.confirm")}
      confirmDisabled={!check.ok}
      dirty={target.trim() !== (domain.redirectTo ?? "")}
      onConfirm={async () => {
        if (!check.ok) throw new Error("invalid");
        await postJson(`/api/domains/${encodeURIComponent(domain.id)}/redirect`, {
          redirectTo: check.value,
          redirectStatus: status,
        });
        done(t("appConfig.domains.redirect.toast"));
      }}
    >
      <div className="flex flex-col gap-3">
        <p role="note" className="rounded-sm bg-warn-soft p-3 text-sm leading-7 text-warn-ink">
          {t("appConfig.domains.redirect.warning")}
        </p>
        <Field
          label={t("appConfig.domains.redirect.targetLabel")}
          hint={t("appConfig.domains.redirect.targetHint")}
          error={invalid ? t("appConfig.domains.redirect.invalid") : undefined}
        >
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              className="text-start font-mono"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="www.example.com"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
        <Field label={t("appConfig.domains.redirect.statusLabel")}>
          {(p) => (
            <Select
              id={p.id}
              value={String(status)}
              onValueChange={(v) => setStatus(v === "302" ? 302 : 301)}
              options={[
                { value: "301", label: t("appConfig.domains.redirect.s301") },
                { value: "302", label: t("appConfig.domains.redirect.s302") },
              ]}
            />
          )}
        </Field>
      </div>
    </OpDialog>
  );
}
