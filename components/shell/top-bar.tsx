"use client";

import { ChevronDown, LogOut, Menu, Wallet } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { resetAccountClientState } from "@/lib/client/account-reset";
import { faNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import { AnimatedNumber } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";

export interface ShellUser {
  userName?: string;
  /** Team mode: the team the session works in (shown in the account menu). */
  teamName?: string;
  accountId?: string;
}

export interface NavItem {
  href: string;
  label: string;
  active?: boolean;
  /** Icon for the desktop rail and the mobile tab bar (decorative; the label names the link). */
  icon?: ReactNode;
}

export interface TopBarProps {
  user?: ShellUser | null;
  /** Project (network) switcher, rendered at the start of the bar. */
  projectSwitcher?: ReactNode;
  /** Extra navigation rendered inline in the bar from lg up (the product uses `navItems` and the rail instead). */
  nav?: ReactNode;
  /** The destinations as data: the desktop rail, the mobile tab bar and the mobile menu button list them. */
  navItems?: NavItem[];
  /** Quick actions (command bar etc.), rendered before the health watch. */
  actions?: ReactNode;
  /** Health-watch indicator (polling status + alerts). */
  healthWatch?: ReactNode;
  /** Account balance chip, e.g. <BalanceChip toman={...} />. */
  balance?: ReactNode;
}

/** Small presentational chip for the `balance` slot. `toman === null` renders an unknown balance. */
export function BalanceChip({ toman, source = "user", unreadable = false }: { toman: number | null; source?: "team" | "user"; unreadable?: boolean }) {
  const label = unreadable ? t("shell.teamBalanceUnreadable") : source === "team" ? t("shell.teamBalance") : t("shell.balance");
  return (
    <span
      title={label}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface-muted/60 ps-2.5 pe-3 text-sm font-medium tabular-nums"
    >
      <Wallet aria-hidden className="size-4 text-muted" />
      <span className="sr-only">{label}:</span>
      {toman === null || !Number.isFinite(toman) ? (
        <span className="text-muted">{t("common.dash")}</span>
      ) : (
        <span className="inline-flex items-baseline gap-1">
          <AnimatedNumber value={toman} format={(n) => faNumber(Math.round(n))} countUp />
          <span className="text-xs font-normal text-muted">{t("common.toman")}</span>
        </span>
      )}
    </span>
  );
}

/**
 * The slim (52 px) bar above the content. Desktop: where you are (workspace / section), command search, balance,
 * notifications. Mobile: menu + logo + the same tools; the account menu lives here below lg (in the rail above).
 */
export function TopBar({ user, projectSwitcher, nav, navItems, actions, healthWatch, balance }: TopBarProps) {
  const section = navItems?.find((i) => i.active)?.label;
  const workspace = user?.teamName ?? user?.userName;
  return (
    <header className="relative z-30 flex h-13 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-2 backdrop-blur-md sm:px-3 lg:gap-3 lg:px-5">
      {navItems?.length ? <MobileMenu items={navItems} /> : null}
      <Link
        href="/"
        aria-label={t("shell.logoLabel")}
        className="flex size-11 shrink-0 items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden"
      >
        <LogoMark className="size-7" />
      </Link>

      <div className="flex min-w-0 items-center gap-2 text-sm">
        {projectSwitcher ? <div className="min-w-0 shrink-0">{projectSwitcher}</div> : null}
        {workspace && !projectSwitcher ? (
          <span className="hidden min-w-0 items-center gap-2 lg:inline-flex">
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-surface-muted text-xs font-bold text-muted ring-1 ring-inset ring-border">
              {initialOf(workspace)}
            </span>
            <bdi dir="auto" className="max-w-40 truncate text-muted">
              {workspace}
            </bdi>
          </span>
        ) : null}
        {section ? (
          <>
            {workspace || projectSwitcher ? (
              <span aria-hidden className="hidden text-border-strong lg:inline">
                /
              </span>
            ) : null}
            <span className="truncate font-semibold text-foreground">{section}</span>
          </>
        ) : null}
      </div>
      {nav ? <div className="hidden min-w-0 items-center gap-1 lg:flex">{nav}</div> : null}

      <div className="ms-auto flex items-center gap-1 sm:gap-2">
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        {balance ? <div className="hidden sm:flex">{balance}</div> : null}
        {healthWatch ? <div className="flex items-center">{healthWatch}</div> : null}
        {user ? (
          <div className="lg:hidden">
            <AccountMenu user={user} />
          </div>
        ) : null}
      </div>
    </header>
  );
}

export const initialOf = (name: string) => Array.from(name.trim())[0] ?? "?";

/** Below lg the rail is hidden; this menu button lists the same destinations (>= 44 px targets, closes on navigation). */
function MobileMenu({ items }: { items: NavItem[] }) {
  return (
    <div className="lg:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("shell.mobileMenu")}
          className="inline-flex size-11 items-center justify-center rounded-sm text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[state=open]:bg-surface-muted"
        >
          <Menu aria-hidden className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label={t("shell.mobileMenu")} className="min-w-60">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.href}
              asChild
              className={cn("gap-3", item.active ? "bg-accent-soft font-semibold text-accent-ink" : undefined)}
            >
              <Link href={item.href} aria-current={item.active ? "page" : undefined}>
                {item.icon ? (
                  <span aria-hidden className={cn("[&>svg]:size-[18px]", item.active ? "text-accent-ink" : "text-muted")}>
                    {item.icon}
                  </span>
                ) : null}
                {item.label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Account menu. `variant="rail"` is the desktop rail's footer (avatar, name revealed when the rail expands);
 * the default is the compact top-bar trigger used below lg.
 */
export function AccountMenu({ user, variant = "bar" }: { user: ShellUser; variant?: "bar" | "rail" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const name = user.userName ?? t("shell.account");

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/session", { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      resetAccountClientState(queryClient);
      router.replace("/connect");
      router.refresh();
    } catch {
      setBusy(false);
      toast({ title: t("shell.disconnectFailed"), variant: "error" });
    }
  }

  const avatar = (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-ink ring-1 ring-inset ring-accent/25"
    >
      {initialOf(name)}
    </span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("shell.accountMenu")}
        className={cn(
          "inline-flex items-center gap-2.5 rounded-sm text-sm transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[state=open]:bg-surface-muted",
          variant === "rail" ? "h-11 w-full px-1.5 text-start" : "size-11 justify-center",
        )}
      >
        {avatar}
        {variant === "rail" ? (
          <span className="flex min-w-0 flex-1 flex-col leading-tight opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
            <bdi dir="auto" className="truncate font-medium text-foreground">
              {name}
            </bdi>
            {user.teamName ? (
              <bdi dir="auto" className="truncate text-xs text-muted">
                {user.teamName}
              </bdi>
            ) : null}
          </span>
        ) : null}
        {variant === "rail" ? (
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover/rail:opacity-100 group-focus-within/rail:opacity-100" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={variant === "rail" ? "left" : "bottom"}
        align="end"
        sideOffset={variant === "rail" ? 10 : 6}
        className="min-w-60"
      >
        <DropdownMenuLabel>
          {t("shell.signedInAs")}{" "}
          <bdi dir="auto" className="font-medium text-foreground">
            {name}
          </bdi>
        </DropdownMenuLabel>
        {user.teamName ? (
          <DropdownMenuLabel>
            {t("shell.team")}{" "}
            <bdi dir="auto" className="font-medium text-foreground">
              {user.teamName}
            </bdi>
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          danger
          disabled={busy}
          onSelect={(e) => {
            e.preventDefault();
            void disconnect();
          }}
        >
          <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
          {busy ? t("shell.disconnecting") : t("shell.disconnect")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
