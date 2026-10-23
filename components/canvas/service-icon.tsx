import { createElement } from "react";
import { Box, Database, Globe, Server, type LucideIcon } from "lucide-react";
import type { ServiceKind } from "@/lib/canvas/types";
import { cn } from "@/lib/utils";

const STATIC_SITES = new Set(["static", "react", "vue", "angular"]);

export function serviceIcon(kind: ServiceKind, platformOrEngine: string): LucideIcon {
  if (kind === "db") return Database;
  if (STATIC_SITES.has(platformOrEngine)) return Globe;
  if (platformOrEngine === "docker") return Box;
  return Server;
}

export function ServiceIcon({ kind, platformOrEngine, className }: { kind: ServiceKind; platformOrEngine: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg",
        kind === "db" ? "bg-warn-soft text-warn-ink" : "bg-accent-soft text-accent-ink",
        className,
      )}
    >
      {createElement(serviceIcon(kind, platformOrEngine), { className: "size-5" })}
    </span>
  );
}
