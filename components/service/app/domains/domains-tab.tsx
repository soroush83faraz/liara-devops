"use client";

import { Globe, Plus } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import { t } from "@/lib/i18n/t";
import { useDomainList } from "@/lib/service/app-config/client";
import { ListSkeleton, LoadError } from "@/lib/service/app-config/ui/load-state";
import type { AppPanelProps } from "@/lib/service/app-read/types";
import { AddDomainDialog } from "./add-domain-dialog";
import { DomainCard } from "./domain-card";

/** Custom domains: add, DNS check (Domain doctor), SSL, redirect, delete. */
export function DomainsTab({ name }: AppPanelProps) {
  const q = useDomainList(name);
  const [adding, setAdding] = useState(false);
  const domains = q.data?.domains;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="domains-title">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="domains-title" className="text-lg font-semibold">
          {t("appConfig.domains.title")}
        </h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" />
          {t("appConfig.domains.addButton")}
        </Button>
      </header>

      {q.isPending ? <ListSkeleton rows={2} /> : null}
      {q.isError ? <LoadError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}

      {domains && domains.length === 0 ? (
        <EmptyState
          icon={<Globe />}
          title={t("appConfig.domains.emptyTitle")}
          description={t("appConfig.domains.emptyBody")}
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" />
              {t("appConfig.domains.addButton")}
            </Button>
          }
        />
      ) : null}

      {domains && domains.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {domains.map((d) => (
            <DomainCard key={d.id || d.name} appName={name} domain={d} />
          ))}
        </ul>
      ) : null}

      {adding ? <AddDomainDialog appName={name} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}
