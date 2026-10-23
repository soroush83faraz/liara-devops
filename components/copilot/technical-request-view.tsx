"use client";

import { useMemo } from "react";
import type { ActionParams } from "@/lib/contracts";
import { fa } from "@/lib/i18n/fa";
import { buildTechnicalRequests } from "@/lib/copilot/technical-request";
import { Disclosure } from "./disclosure";
import { LtrBlock } from "./ltr-block";

const l = fa.copilotUi.approval;

/** Collapsed «نمایش درخواست فنی»: method + path + masked body, for people who want the exact API call. */
export function TechnicalRequestView({ params }: { params: ActionParams }) {
  const requests = useMemo(() => buildTechnicalRequests(params), [params]);
  if (requests.length === 0) return null;
  return (
    <Disclosure summary={l.technical}>
      <div className="flex flex-col gap-3">
        <p className="text-xs leading-6 text-muted">{l.technicalNote}</p>
        {requests.map((r, i) => (
          <div key={i} className="flex flex-col gap-1">
            <LtrBlock
              text={`${r.method} ${r.path}${r.body ? `\n${r.body}` : ""}`}
              copy
              maxHeightClass="max-h-48"
              label={l.technical}
            />
            {r.note ? (
              <bdi dir="ltr" className="block text-start font-mono text-xs text-muted">
                {`// ${r.note}`}
              </bdi>
            ) : null}
          </div>
        ))}
      </div>
    </Disclosure>
  );
}
