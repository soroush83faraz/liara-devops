"use client";

// The product's standard frame: AppShell + navigation + command bar + health watch + balance.
// Every authenticated page uses this so the rail and the top bar are identical everywhere.
import { Activity, History, Rocket, Siren, Waypoints } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CanvasBalanceChip, HealthWatchIndicator } from "@/components/canvas";
import { GlobalCommandBar } from "@/components/copilot";
import { AppShell, type AppShellProps } from "@/components/shell/app-shell";
import { t } from "@/lib/i18n/t";

const NAV = [
  { href: "/", label: "shell.nav.canvas", icon: Waypoints, match: (p: string) => p === "/" },
  { href: "/observability", label: "observability.nav", icon: Activity, match: (p: string) => p.startsWith("/observability") },
  { href: "/incidents", label: "shell.nav.incidents", icon: Siren, match: (p: string) => p.startsWith("/incidents") },
  { href: "/activity", label: "shell.nav.activity", icon: History, match: (p: string) => p.startsWith("/activity") },
  { href: "/setup", label: "shell.nav.setup", icon: Rocket, match: (p: string) => p.startsWith("/setup") },
] as const;

/** Index of the first destination pinned to the bottom of the desktop rail (setup). */
const RAIL_SPLIT = 4;

/** The destinations as data: the rail (desktop), the bottom tab bar and the menu button (mobile) list them. */
function useNavItems() {
  const pathname = usePathname() ?? "/";
  return NAV.map(({ href, label, icon: Icon, match }) => ({
    href,
    label: t(label),
    active: match(pathname),
    icon: <Icon className={href === "/setup" ? "rtl:-scale-x-100" : undefined} />,
  }));
}

export type ProductShellProps = Omit<AppShellProps, "nav" | "navItems" | "actions" | "healthWatch" | "balance" | "railSplitAt"> & { children: ReactNode };

export function ProductShell(props: ProductShellProps) {
  const navItems = useNavItems();
  return (
    <AppShell
      {...props}
      navItems={navItems}
      railSplitAt={RAIL_SPLIT}
      actions={
        <GlobalCommandBar className="size-11 min-h-0 rounded-sm border-transparent bg-transparent px-0 md:min-h-0 lg:h-9 lg:w-72 lg:justify-start lg:gap-2.5 lg:border-border lg:bg-surface-muted/60 lg:px-3 lg:[&>span:last-child]:ms-auto" />
      }
      healthWatch={<HealthWatchIndicator />}
      balance={<CanvasBalanceChip />}
    />
  );
}
