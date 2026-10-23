"use client";

// The product's standard frame: AppShell + navigation + command bar + health watch + balance.
// Every authenticated page uses this so the top bar is identical everywhere.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CanvasBalanceChip, HealthWatchIndicator } from "@/components/canvas";
import { GlobalCommandBar } from "@/components/copilot";
import { SetupEntryLink } from "@/components/setup";
import { AppShell, type AppShellProps } from "@/components/shell/app-shell";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "shell.nav.canvas", match: (p: string) => p === "/" },
  { href: "/observability", label: "observability.nav", match: (p: string) => p.startsWith("/observability") },
  { href: "/incidents", label: "shell.nav.incidents", match: (p: string) => p.startsWith("/incidents") },
  { href: "/activity", label: "shell.nav.activity", match: (p: string) => p.startsWith("/activity") },
] as const;

function ProductNav() {
  const pathname = usePathname() ?? "/";
  return (
    <>
      {NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active ? "bg-accent-soft font-semibold text-accent-ink" : "text-muted hover:bg-surface-muted hover:text-foreground",
            )}
          >
            {t(item.label)}
          </Link>
        );
      })}
      <SetupEntryLink variant="ghost" />
    </>
  );
}

/** The destinations as data (the mobile menu lists them; `ProductNav` renders them inline from md up). */
function useNavItems() {
  const pathname = usePathname() ?? "/";
  return [
    ...NAV.map((item) => ({ href: item.href, label: t(item.label), active: item.match(pathname) })),
    { href: "/setup", label: t("shell.nav.setup"), active: pathname.startsWith("/setup") },
  ];
}

export type ProductShellProps = Omit<AppShellProps, "nav" | "navItems" | "actions" | "healthWatch" | "balance"> & { children: ReactNode };

export function ProductShell(props: ProductShellProps) {
  const navItems = useNavItems();
  return (
    <AppShell
      {...props}
      nav={<ProductNav />}
      navItems={navItems}
      actions={<GlobalCommandBar />}
      healthWatch={<HealthWatchIndicator />}
      balance={<CanvasBalanceChip />}
    />
  );
}
