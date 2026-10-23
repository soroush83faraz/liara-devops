import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Titled section of the settings tab. */
export function SettingsCard({
  id,
  title,
  description,
  tone = "default",
  children,
}: {
  id: string;
  title: string;
  description?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface p-4",
        tone === "danger" ? "border-danger/50" : "border-border",
      )}
    >
      <header>
        <h3 id={`${id}-title`} className={cn("text-base font-semibold", tone === "danger" && "text-danger")}>
          {title}
        </h3>
        {description ? <p className="text-sm leading-7 text-muted">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
