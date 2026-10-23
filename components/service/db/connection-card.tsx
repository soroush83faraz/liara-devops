"use client";

import { Cable } from "lucide-react";
import { useState } from "react";
import { CopyButton, Skeleton } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { buildConnectionString, type ConnectionEndpointDto, type DbConnectionDto } from "@/lib/service/db/connection";
import { PasswordReveal } from "./password-reveal";
import { CodeLine, QueryError, SectionCard, Unavailable } from "./shared";
import { useDbConnection } from "./use-db";

function Endpoint({
  title,
  hint,
  ep,
  conn,
  secret,
  missingText,
}: {
  title: string;
  hint: string;
  ep: ConnectionEndpointDto;
  conn: DbConnectionDto;
  secret: string | null;
  missingText?: string;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div>
        <h4 className="text-[15px] font-semibold leading-7">{title}</h4>
        <p className="text-xs leading-6 text-muted">{hint}</p>
      </div>
      {!ep.available ? (
        <p className="text-sm leading-7 text-muted">{missingText}</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{t("dbPanel.connection.host")}</dt>
            <dd className="flex min-w-0 items-center justify-between gap-2">
              <bdi dir="ltr" className="min-w-0 break-all font-mono text-[13px]">{ep.host}</bdi>
              {ep.host ? <CopyButton value={ep.host} size="sm" /> : null}
            </dd>
            <dt className="text-muted">{t("dbPanel.connection.port")}</dt>
            <dd className="flex min-w-0 items-center justify-between gap-2">
              {ep.port ? (
                <>
                  <bdi dir="ltr" className="font-mono text-[13px]">{ep.port}</bdi>
                  <CopyButton value={String(ep.port)} size="sm" />
                </>
              ) : (
                <span className="text-muted">{t("dbPanel.connection.portMissing")}</span>
              )}
            </dd>
          </dl>
          {ep.url ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{t("dbPanel.connection.url")}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <CopyButton value={ep.url} size="sm" />
                  {secret !== null ? (
                    <CopyButton
                      value={buildConnectionString({ engine: conn.engine, host: ep.host, port: ep.port, username: conn.username, dbName: conn.dbName }, secret) ?? ep.url}
                      label={t("dbPanel.connection.copyWithPassword")}
                      size="sm"
                    />
                  ) : null}
                </span>
              </div>
              <CodeLine label={t("dbPanel.connection.url")}>{ep.url}</CodeLine>
            </div>
          ) : (
            <p className="text-xs leading-6 text-muted">{t("dbPanel.connection.noTemplate")}</p>
          )}
        </>
      )}
    </section>
  );
}

export function ConnectionCard({ host }: { host: string }) {
  const q = useDbConnection(host);
  // Held only to build a copy-only string while the password is revealed; cleared by PasswordReveal.
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <SectionCard title={t("dbPanel.connection.title")} icon={<Cable />}>
      {q.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{t("dbPanel.connection.username")}</dt>
            <dd>{q.data.username ? <bdi dir="ltr" className="font-mono text-[13px]">{q.data.username}</bdi> : <Unavailable />}</dd>
            <dt className="text-muted">{t("dbPanel.connection.dbName")}</dt>
            <dd>{q.data.dbName ? <bdi dir="ltr" className="font-mono text-[13px]">{q.data.dbName}</bdi> : <span className="text-muted">—</span>}</dd>
          </dl>
          <PasswordReveal host={host} onSecret={setSecret} />
          <Endpoint
            title={t("dbPanel.connection.privateTitle")}
            hint={t("dbPanel.connection.privateHint")}
            ep={q.data.private}
            conn={q.data}
            secret={secret}
            missingText={t("dbPanel.connection.privateMissing")}
          />
          <Endpoint
            title={t("dbPanel.connection.publicTitle")}
            hint={t("dbPanel.connection.publicHint")}
            ep={q.data.public}
            conn={q.data}
            secret={secret}
            missingText={q.data.publicNetwork ? t("dbPanel.connection.publicMissing") : t("dbPanel.connection.publicOff")}
          />
          <p className="text-xs leading-6 text-muted">{t("dbPanel.connection.placeholderNote")}</p>
        </div>
      )}
    </SectionCard>
  );
}
