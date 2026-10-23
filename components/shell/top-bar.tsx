"use client";

import { ChevronDown, LogOut, Menu, User, Wallet } from "lucide-react";
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
import { faPrice } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
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
}

export interface TopBarProps {
  user?: ShellUser | null;
  /** Project (network) switcher, rendered after the logo. */
  projectSwitcher?: ReactNode;
  /** Primary navigation links, rendered after the project switcher (collapses on small screens). */
  nav?: ReactNode;
  /** The same destinations as `nav`, as data: listed in the menu button that replaces `nav` below the md breakpoint. */
  navItems?: NavItem[];
  /** Right-side quick actions (command bar etc.), rendered before the health watch. */
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
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm tabular-nums"
    >
      <Wallet aria-hidden className="size-4 text-muted" />
      <span className="sr-only">{label}:</span>
      {toman === null ? t("common.dash") : faPrice(toman)}
    </span>
  );
}

export function TopBar({ user, projectSwitcher, nav, navItems, actions, healthWatch, balance }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <nav aria-label={t("shell.mainNav")} className="flex min-h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        {navItems?.length ? <MobileMenu items={navItems} /> : null}
        <Link
          href="/"
          aria-label={t("shell.logoLabel")}
          className="-ms-1 flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <LogoMark />
          <span className="hidden text-base font-bold text-accent sm:inline">{t("common.appName")}</span>
        </Link>

        {projectSwitcher ? <div className="min-w-0 sm:ms-2">{projectSwitcher}</div> : null}
        {nav ? <div className="hidden min-w-0 items-center gap-1 md:flex">{nav}</div> : null}

        <div className="ms-auto flex items-center gap-2">
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          {healthWatch ? <div className="flex items-center">{healthWatch}</div> : null}
          {balance ? <div className="hidden sm:flex">{balance}</div> : null}
          {user ? <AccountMenu user={user} /> : null}
        </div>
      </nav>
    </header>
  );
}

/** Below md the inline nav is hidden; this menu button lists the same destinations (>= 44 px targets, closes on navigation). */
function MobileMenu({ items }: { items: NavItem[] }) {
  return (
    <div className="md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("shell.mobileMenu")}
          className="-ms-1 inline-flex size-11 items-center justify-center rounded-lg text-foreground hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Menu aria-hidden className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label={t("shell.mobileMenu")} className="min-w-56">
          {items.map((item) => (
            <DropdownMenuItem key={item.href} asChild className={item.active ? "bg-accent-soft font-semibold text-accent-ink" : undefined}>
              <Link href={item.href} aria-current={item.active ? "page" : undefined}>
                {item.label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AccountMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("shell.accountMenu")}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-transparent px-2 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-10"
      >
        <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
          <User className="size-4" />
        </span>
        <span className="hidden max-w-32 truncate sm:inline">{user.userName ?? t("shell.account")}</span>
        <ChevronDown aria-hidden className="size-4 text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          {t("shell.signedInAs")}{" "}
          <bdi dir="auto" className="font-medium text-foreground">
            {user.userName ?? t("shell.account")}
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
        <DropdownMenuItem danger disabled={busy} onSelect={(e) => {
          e.preventDefault();
          void disconnect();
        }}>
          <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
          {busy ? t("shell.disconnecting") : t("shell.disconnect")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
