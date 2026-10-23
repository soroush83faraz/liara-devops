"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/copilot/clipboard";
import { t } from "@/lib/i18n/t";
import { IconButton } from "./icon-button";
import { Button } from "./button";

/**
 * Copies `value` and announces the result through a polite live region.
 * Without `label` it renders as an icon button; with `label` as a text button.
 */
export function CopyButton({
  value,
  label,
  size = "md",
  className,
  onCopied,
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    const ok = await copyToClipboard(value);
    setState(ok ? "copied" : "failed");
    if (ok) onCopied?.();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }, [value, onCopied]);

  const announcement = state === "copied" ? t("common.copied") : state === "failed" ? t("common.copyFailed") : "";
  const icon = state === "copied" ? <Check aria-hidden className="size-4 text-ok" /> : <Copy aria-hidden className="size-4" />;

  return (
    <>
      {label ? (
        <Button variant="secondary" size={size} onClick={copy} className={className}>
          {icon}
          {state === "copied" ? t("common.copied") : label}
        </Button>
      ) : (
        <IconButton
          label={state === "copied" ? t("common.copied") : t("common.copy")}
          icon={icon}
          size={size}
          onClick={copy}
          className={className}
        />
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
