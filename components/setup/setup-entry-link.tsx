import { Rocket } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

/**
 * Entry point to the setup assistant (/setup). Drop it into the top bar or the canvas empty state:
 *   <SetupEntryLink />                       compact button
 *   <SetupEntryLink variant="primary" showHint />
 */
export function SetupEntryLink({
  variant = "secondary",
  showHint = false,
  className,
}: {
  variant?: "primary" | "secondary" | "ghost";
  showHint?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-col items-center gap-1", className)}>
      <Link href="/setup" className={buttonVariants({ variant, size: "sm" })}>
        <Rocket aria-hidden className="size-4 rtl:-scale-x-100" />
        {t("setupFlow.entry.link")}
      </Link>
      {showHint ? <span className="max-w-xs text-center text-xs leading-6 text-muted">{t("setupFlow.entry.hint")}</span> : null}
    </span>
  );
}
