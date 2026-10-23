import type { ReactNode } from "react";
import { fa } from "@/lib/i18n/fa";
import { MASK, type DiffLine, type MaskedSource } from "@/lib/copilot/diff";
import { cn } from "@/lib/utils";
import { Template } from "./template";

const l = fa.copilotUi.approval;

function maskedNote(v: MaskedSource): ReactNode {
  switch (v.kind) {
    case "generated":
      return l.valueMaskedGenerated;
    case "user":
      return l.valueMaskedUser;
    case "existing":
      return (
        <>
          {l.valueMaskedExisting}{" "}
          <bdi dir="ltr" className="font-mono text-xs">
            {v.from}
          </bdi>
        </>
      );
    case "db":
      return (
        <>
          {l.valueMaskedDb}{" "}
          <bdi dir="ltr" className="font-mono text-xs">
            {v.db}.{v.field}
          </bdi>
        </>
      );
  }
}

const SIGN_STYLE = {
  "+": { cls: "text-ok", label: l.signLabel.plus },
  "-": { cls: "text-danger", label: l.signLabel.minus },
  "~": { cls: "text-muted", label: l.signLabel.tilde },
} as const;

/**
 * The exact change as a diff. Env VALUES are never shown: a line reads
 * `+ SESSION_SECRET = ••••••  (ساخته‌شده توسط سرور)`. The sign is a text character (not colour only).
 */
export function DiffView({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0) return <p className="text-sm text-muted">{l.noChanges}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-code-bg" aria-label={l.changes}>
      {lines.map((line, i) => {
        const sign = SIGN_STYLE[line.sign];
        return (
          <li key={i} className={cn("flex items-start gap-2 px-3 py-2 text-sm leading-7", line.step && line.label && "bg-surface-muted/60")}>
            <span aria-hidden className={cn("w-4 shrink-0 text-center font-mono font-bold", sign.cls)}>
              {line.sign}
            </span>
            <span className="sr-only">{sign.label}</span>
            <span className="min-w-0 flex-1 break-words">
              {line.label ? (
                <Template template={l.diff[line.label.key]} params={line.label.params} />
              ) : (
                <>
                  <bdi dir="ltr" className="font-mono text-[13px]">
                    {line.code}
                    {line.value ? ` = ${MASK}` : ""}
                  </bdi>
                  {line.value ? <span className="ms-2 text-xs text-muted">({maskedNote(line.value)})</span> : null}
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
