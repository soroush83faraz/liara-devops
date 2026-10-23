"use client";

import { ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { postJson } from "@/lib/service/app-config/client";
import type { DomainDto } from "@/lib/service/app-config/dto";
import { domainTargetName, sslState } from "@/lib/service/app-config/domain-doctor";
import { OpDialog } from "@/lib/service/app-config/ui/op-dialog";
import { useAfterMutation } from "@/lib/service/app-config/ui/toast";

type Dialog = "enable" | "disable" | null;

/**
 * SSL actions by state: none -> provision; pending -> re-request/refresh hint; active -> disable (typed name).
 * «requested» only means Liara accepted the request; the badge changes when Liara reports ACTIVE.
 */
export function SslControl({ appName, domain }: { appName: string; domain: DomainDto }) {
  const done = useAfterMutation(appName);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [requested, setRequested] = useState(false);
  const state = sslState(domain.certificatesStatus);
  const url = `/api/domains/${encodeURIComponent(domain.id)}/ssl`;
  const target = domainTargetName(domain.name);

  return (
    <>
      {state === "active" ? (
        <Button variant="secondary" size="sm" onClick={() => setDialog("disable")} disabled={!domain.id}>
          <ShieldOff aria-hidden className="size-4" />
          {t("appConfig.domains.ssl.disable")}
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setDialog("enable")} disabled={!domain.id}>
          <ShieldCheck aria-hidden className="size-4" />
          {state === "pending" || requested ? t("appConfig.domains.ssl.retry") : t("appConfig.domains.ssl.provision")}
        </Button>
      )}
      {requested && state !== "active" ? (
        <p role="status" className="basis-full text-xs leading-6 text-muted">
          {t("appConfig.domains.ssl.requestedNote")}
        </p>
      ) : null}

      {dialog === "enable" ? (
        <OpDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title={t("appConfig.domains.ssl.provisionTitle")}
          operation={t("appConfig.domains.ssl.provisionOperation")}
          target={domain.name}
          effect={t("appConfig.domains.ssl.provisionEffect")}
          risk={t("appConfig.domains.ssl.provisionRisk")}
          reversible="yes"
          confirmLabel={t("appConfig.domains.ssl.provisionConfirm")}
          onConfirm={async () => {
            await postJson(url, { enable: true });
            setRequested(true);
            done(t("appConfig.domains.ssl.requestedToast"));
          }}
        />
      ) : null}
      {dialog === "disable" ? (
        <OpDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title={t("appConfig.domains.ssl.disableTitle")}
          operation={t("appConfig.domains.ssl.disableOperation")}
          target={domain.name}
          effect={t("appConfig.domains.ssl.disableEffect")}
          risk={t("appConfig.domains.ssl.disableRisk")}
          reversible="partly"
          typedName={target}
          danger
          confirmLabel={t("appConfig.domains.ssl.disableConfirm")}
          onConfirm={async () => {
            await postJson(url, { enable: false, typedName: target });
            done(t("appConfig.domains.ssl.disabledToast"));
          }}
        />
      ) : null}
    </>
  );
}
