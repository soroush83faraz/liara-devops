"use client";

import { CircleCheck, CircleHelp, CircleSlash, Clock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge, Button, CopyButton } from "@/components/ui";
import { faDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { postJson } from "@/lib/service/app-config/client";
import type { DnsRecordDto, DomainCheckDto, DomainDto } from "@/lib/service/app-config/dto";
import {
  dnsVerdict,
  domainGuidance,
  domainStateSnapshot,
  recordState,
  type RecordState,
} from "@/lib/service/app-config/domain-doctor";
import { describeError, type DescribedError } from "@/lib/service/app-config/errors";
import { ErrorNotice } from "@/lib/service/app-config/ui/error-notice";

const STATE_VIEW: Record<RecordState, { tone: "neutral" | "ok" | "warn"; Icon: typeof Clock }> = {
  not_checked: { tone: "neutral", Icon: CircleHelp },
  confirmed: { tone: "ok", Icon: CircleCheck },
  pending: { tone: "warn", Icon: Clock },
  unavailable: { tone: "neutral", Icon: CircleSlash },
};

const RECORD_TITLE = {
  cname: "appConfig.domains.doctor.record.cname",
  verification: "appConfig.domains.doctor.record.verification",
  acme: "appConfig.domains.doctor.record.acme",
} as const;
const RECORD_NOTE = {
  cname: "appConfig.domains.doctor.recordNote.cname",
  verification: "appConfig.domains.doctor.recordNote.verification",
  acme: "appConfig.domains.doctor.recordNote.acme",
} as const;

/**
 * Domain doctor. Shows exactly what Liara returned, per-record state from the last `check`, and plain
 * guidance. Nothing is called «configured» until a check response says ACTIVE.
 */
export function DomainDoctor({
  domain,
  onChecked,
}: {
  domain: DomainDto;
  onChecked?: (domain: DomainDto) => void;
}) {
  const [shown, setShown] = useState<{ base: DomainDto; data: DomainDto; at: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DescribedError | null>(null);

  const checked = shown && shown.base === domain ? shown : null;
  const view = checked?.data ?? domain;
  const snapshot = checked ? domainStateSnapshot(checked.data) : null;
  const verdict = dnsVerdict(snapshot);
  const g = domainGuidance(view.name);

  async function check() {
    if (!domain.id) return;
    setPending(true);
    setError(null);
    try {
      const res = await postJson<DomainCheckDto>(`/api/domains/${encodeURIComponent(domain.id)}/check`, {});
      // Keep records from the list when the check response omits them.
      const merged: DomainDto = {
        ...res.domain,
        records: res.domain.records.map((r) =>
          r.value === null ? (domain.records.find((x) => x.kind === r.kind && x.value !== null) ?? r) : r,
        ),
      };
      setShown({ base: domain, data: merged, at: res.checkedAt });
      onChecked?.(merged);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{t("appConfig.domains.doctor.title")}</h3>
          <p className="text-sm text-muted">{t("appConfig.domains.doctor.lead")}</p>
        </div>
        <Button size="sm" onClick={() => void check()} loading={pending} disabled={!domain.id}>
          {pending ? null : <RefreshCw aria-hidden className="size-4" />}
          {t("appConfig.domains.doctor.check")}
        </Button>
      </div>

      <div
        role="status"
        aria-live="polite"
        className={
          verdict === "confirmed"
            ? "rounded-lg bg-ok-soft p-3 text-sm leading-7 text-ok-ink"
            : verdict === "pending"
              ? "rounded-lg bg-warn-soft p-3 text-sm leading-7 text-warn-ink"
              : "rounded-lg bg-surface-muted p-3 text-sm leading-7 text-muted"
        }
      >
        {t(`appConfig.domains.doctor.verdict.${verdict}`)}
        {checked ? (
          <span className="block text-xs opacity-80">{t("appConfig.domains.doctor.checkedAt", { time: faDateTime(checked.at) })}</span>
        ) : null}
      </div>
      {error ? <ErrorNotice error={error} /> : null}

      <ul className="flex flex-col gap-3">
        {view.records.map((r) => (
          <RecordItem key={r.kind} record={r} domainName={view.name} state={recordState(r.kind, r.value, snapshot)} />
        ))}
      </ul>

      <Guidance ir={g.ir} apex={g.apex} wildcard={g.wildcard} />
    </div>
  );
}

function RecordItem({ record, domainName, state }: { record: DnsRecordDto; domainName: string; state: RecordState }) {
  const { tone, Icon } = STATE_VIEW[state];
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t(RECORD_TITLE[record.kind])}</p>
        <Badge tone={tone}>
          <Icon aria-hidden className="size-3" />
          {t(`appConfig.domains.doctor.state.${state}`)}
        </Badge>
      </div>
      {record.kind === "cname" ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {t("appConfig.domains.doctor.host")}
          <bdi dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono text-[12px] text-code-fg">
            {domainName}
          </bdi>
        </p>
      ) : null}
      {record.value !== null ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-code-bg px-2 py-1.5">
          <bdi dir="ltr" className="min-w-0 break-all font-mono text-[13px] text-code-fg">
            {record.value}
          </bdi>
          <CopyButton value={record.value} size="sm" />
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">{t("appConfig.domains.doctor.consoleHint")}</p>
      )}
      <p className="mt-2 text-xs leading-6 text-muted">
        {t(RECORD_NOTE[record.kind])}
        {record.kind === "acme" && record.sourceKey ? (
          <>
            {" "}
            <bdi dir="ltr" className="font-mono">
              {record.sourceKey}
            </bdi>
          </>
        ) : null}
      </p>
    </li>
  );
}

function Guidance({ ir, apex, wildcard }: { ir: boolean; apex: boolean; wildcard: boolean }) {
  return (
    <div className="flex flex-col gap-2 text-sm leading-7">
      <details className="rounded-lg border border-border p-3" open>
        <summary className="cursor-pointer font-medium">{t("appConfig.domains.guide.generalTitle")}</summary>
        <ol className="mt-2 list-decimal ps-5 text-muted">
          <li>{t("appConfig.domains.guide.general1")}</li>
          <li>{t("appConfig.domains.guide.general2")}</li>
          <li>{t("appConfig.domains.guide.general3")}</li>
          <li>{t("appConfig.domains.guide.general4")}</li>
        </ol>
      </details>
      {ir ? (
        <details className="rounded-lg border border-border p-3" open>
          <summary className="cursor-pointer font-medium">{t("appConfig.domains.guide.irTitle")}</summary>
          <ol className="mt-2 list-decimal ps-5 text-muted">
            <li>{t("appConfig.domains.guide.ir1")}</li>
            <li>{t("appConfig.domains.guide.ir2")}</li>
            <li>{t("appConfig.domains.guide.ir3")}</li>
            <li>{t("appConfig.domains.guide.ir4")}</li>
          </ol>
        </details>
      ) : null}
      {apex ? <p className="rounded-lg bg-warn-soft p-3 text-warn-ink">{t("appConfig.domains.guide.apex")}</p> : null}
      {wildcard ? <p className="rounded-lg bg-warn-soft p-3 text-warn-ink">{t("appConfig.domains.guide.wildcard")}</p> : null}
      <p className="text-xs leading-6 text-muted">{t("appConfig.domains.guide.limits")}</p>
    </div>
  );
}
