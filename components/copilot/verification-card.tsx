"use client";

import { CircleCheck, CircleDashed, CircleHelp, CircleX, LoaderCircle, TriangleAlert } from "lucide-react";
import { fa } from "@/lib/i18n/fa";
import type { VerificationData } from "@/lib/contracts";
import { checkBasis } from "@/lib/contracts/verification-basis";
import { snapshotCell } from "@/lib/copilot/snapshot-display";
import { fill, stripUnsafeChars } from "@/lib/copilot/text";
import { checkStatus, snapshotRows, verificationHeadline, type CheckDisplayStatus } from "@/lib/copilot/verification";
import { cn } from "@/lib/utils";
import { IncidentButton } from "./incident-button";
import { MockDataBadge } from "./mock-data-badge";

const l = fa.copilotUi.verification;

export const checkLabel = (name: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(l.checkNames, name) ? (l.checkNames as Record<string, string>)[name] : undefined;

/** Presentation per check status: only `passed` is green; unknown is amber, skipped neutral grey. */
export const CHECK_STATUS_VIEW: Record<CheckDisplayStatus, { label: string; Icon: typeof CircleCheck; icon: string; text: string }> = {
  passed: { label: l.passed, Icon: CircleCheck, icon: "text-ok", text: "text-ok-ink" },
  failed: { label: l.failedCheck, Icon: CircleX, icon: "text-danger", text: "text-danger-ink" },
  unknown: { label: l.unknownCheck, Icon: CircleHelp, icon: "text-warn", text: "text-warn-ink" },
  skipped: { label: l.skippedCheck, Icon: CircleDashed, icon: "text-muted", text: "text-muted" },
};

/** Raw enum / code, always LTR and visually a code badge (never part of Persian prose). */
function CodeBadge({ children }: { children: string }) {
  return (
    <bdi dir="ltr" className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </bdi>
  );
}

function SnapshotCell({ k, value }: { k: string; value: string | number | boolean | null | undefined }) {
  const cell = snapshotCell(k, value);
  switch (cell.kind) {
    case "http":
      return <CodeBadge>{cell.code}</CodeBadge>;
    case "state":
      return cell.label ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span>{cell.label}</span>
          <CodeBadge>{cell.raw}</CodeBadge>
        </span>
      ) : (
        <CodeBadge>{cell.raw}</CodeBadge>
      );
    case "text":
      return (
        <bdi dir="ltr" className="font-mono text-xs">
          {cell.text}
        </bdi>
      );
    case "empty":
    case "number":
    case "bool":
      return <span>{cell.text}</span>;
  }
}

export function VerificationBody({ result, incidentId }: { result: VerificationData["result"]; incidentId?: string }) {
  const headline = verificationHeadline(result);
  const rows = snapshotRows(result.before, result.after);

  const tone =
    headline.kind === "verified"
      ? { box: "border-ok/40 bg-ok-soft text-ok-ink", Icon: CircleCheck }
      : headline.kind === "not_verified"
        ? { box: "border-warn/40 bg-warn-soft text-warn-ink", Icon: TriangleAlert }
        : { box: "border-danger/40 bg-danger-soft text-danger-ink", Icon: CircleX };

  // «مشکل برطرف شد» is printed only for a verified headline.
  const title =
    headline.kind === "verified"
      ? l.verified
      : headline.kind === "not_verified"
        ? headline.failedCheck
          ? fill(headline.unproven ? l.notVerifiedUnproven : l.notVerified, { check: checkLabel(headline.failedCheck) ?? headline.failedCheck })
          : l.notVerifiedFallback
        : l.failed;
  const body = headline.kind === "verified" ? l.verifiedBody : headline.kind === "not_verified" ? l.notVerifiedBody : l.failedBody;

  return (
    <section aria-label={l.title} className="flex flex-col gap-3">
      <div role="status" className={cn("flex items-start gap-3 rounded-lg border p-3", tone.box)} data-outcome={headline.kind}>
        <tone.Icon aria-hidden className="mt-1 size-5 shrink-0" />
        <div className="flex flex-col gap-1">
          <MockDataBadge className="self-start" />
          <p className="text-base font-semibold leading-8">{title}</p>
          <p className="text-sm leading-7">{body}</p>
          {headline.kind === "verified" && headline.partial ? <p className="text-sm leading-7">{l.verifiedPartialNote}</p> : null}
        </div>
      </div>

      {result.checks.length > 0 ? (
        <div>
          <h4 className="mb-1 text-sm font-semibold">{l.checks}</h4>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {result.checks.map((c) => {
              const st = checkStatus(c);
              const view = CHECK_STATUS_VIEW[st];
              const basis = checkBasis(c);
              return (
              <li key={c.name} data-check-status={st} className="flex items-start gap-2.5 px-3 py-2 text-sm leading-7">
                <view.Icon aria-hidden className={cn("mt-1.5 size-4 shrink-0", view.icon)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{checkLabel(c.name) ?? c.name}</span>
                  <span className={cn("ms-2 text-xs", view.text)}>({view.label})</span>
                  {basis ? (
                    <span data-check-basis={basis} className="block text-xs leading-6">
                      {l.basis[basis]}
                    </span>
                  ) : null}
                  <bdi dir="auto" className="block break-words text-start text-xs text-muted">
                    {stripUnsafeChars(c.detail)}
                  </bdi>
                </span>
              </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <h4 className="mb-1 text-sm font-semibold">{l.beforeAfter}</h4>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{l.noSnapshot}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-64 text-sm">
              <caption className="sr-only">{l.beforeAfter}</caption>
              <thead className="bg-surface-muted text-start">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {l.field}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {l.before}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {l.after}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="px-3 py-2 text-start font-normal">
                      {(l.snapshotKeys as Record<string, string>)[r.key] ?? (
                        <bdi dir="ltr" className="font-mono text-xs">
                          {r.key}
                        </bdi>
                      )}
                    </th>
                    <td className="px-3 py-2">
                      <SnapshotCell k={r.key} value={r.before} />
                    </td>
                    <td className="px-3 py-2">
                      <SnapshotCell k={r.key} value={r.after} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {incidentId ? <IncidentButton incidentId={incidentId} /> : null}
    </section>
  );
}

/** Shown while the server is still verifying: never implies success. */
export function VerificationPending() {
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-surface-muted p-3 text-sm leading-7">
      <LoaderCircle aria-hidden className="mt-1 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      {l.pending}
    </p>
  );
}
