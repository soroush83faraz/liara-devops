import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

export interface KeyValueItem {
  key: ReactNode;
  value: ReactNode;
  /** Render the value as an isolated LTR monospace fragment (URLs, IPs, ids, env keys). */
  ltr?: boolean;
  /** If set, shows a copy button that copies this exact text. */
  copy?: string;
}

export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {items.map((item, i) => (
        <div key={i} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(7rem,12rem)_1fr] sm:gap-4">
          <dt className="text-sm text-muted">{item.key}</dt>
          <dd className="flex min-w-0 items-center justify-between gap-2 text-[15px]">
            <span className="min-w-0 break-words">
              {item.ltr ? (
                <bdi dir="ltr" className="font-mono text-[0.9em]">
                  {item.value}
                </bdi>
              ) : (
                item.value
              )}
            </span>
            {item.copy ? <CopyButton value={item.copy} size="sm" /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
