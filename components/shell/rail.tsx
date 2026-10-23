"use client";

import Link from "next/link";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";
import { AccountMenu, type NavItem, type ShellUser } from "./top-bar";

/**
 * Desktop (>= lg) navigation rail on the inline-start edge. 64 px of icons; on hover or keyboard focus it expands
 * to 208 px with labels, floating over the content (the content never reflows). Items after `splitAt` sit at the
 * bottom (setup), above the account menu.
 */
export function Rail({ items = [], user, splitAt }: { items?: NavItem[]; user?: ShellUser | null; splitAt?: number }) {
  const primary = splitAt === undefined ? items : items.slice(0, splitAt);
  const secondary = splitAt === undefined ? [] : items.slice(splitAt);
  return (
    <div data-testid="shell-rail" className="relative z-40 hidden w-16 shrink-0 lg:block">
      <div
        className={cn(
          "group/rail absolute inset-y-0 start-0 flex w-16 flex-col overflow-hidden border-e border-border bg-surface",
          "transition-[width,box-shadow] duration-200 ease-out-expo",
          "hover:w-52 hover:shadow-[var(--shadow-pop)] focus-within:w-52 focus-within:shadow-[var(--shadow-pop)]",
        )}
      >
        <Link
          href="/"
          aria-label={t("shell.logoLabel")}
          className="flex h-13 shrink-0 items-center gap-3 border-b border-border px-[18px] outline-none focus-visible:bg-surface-muted"
        >
          <LogoMark className="size-7" />
          <span className="whitespace-nowrap text-[15px] font-bold opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
            {t("common.appName")}
          </span>
        </Link>

        <nav aria-label={t("shell.mainNav")} className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-3">
          {primary.map((item) => (
            <RailLink key={item.href} item={item} />
          ))}
          {secondary.length ? <div className="mt-auto" /> : null}
          {secondary.map((item) => (
            <RailLink key={item.href} item={item} />
          ))}
        </nav>

        {user ? (
          <div className="shrink-0 border-t border-border px-3 py-3">
            <AccountMenu user={user} variant="rail" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RailLink({ item }: { item: NavItem }) {
  return (
    <Link
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      className={cn(
        "relative flex h-10 shrink-0 items-center gap-3 rounded-sm px-[11px] text-sm transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        item.active
          ? "bg-accent-soft font-semibold text-accent-ink"
          : "text-muted hover:bg-surface-muted hover:text-foreground active:bg-surface-muted/70",
      )}
    >
      <span aria-hidden className={cn("flex shrink-0 [&>svg]:size-[18px]", item.active ? "text-accent" : undefined)}>
        {item.icon}
      </span>
      <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
        {item.label}
      </span>
      {item.active ? <span aria-hidden className="absolute inset-y-2.5 -start-3 w-[3px] rounded-e-full bg-accent" /> : null}
    </Link>
  );
}

/** Mobile (< lg) bottom tab bar with the same destinations. */
export function BottomTabs({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label={t("shell.mainNav")}
      className="relative z-30 flex shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs transition-colors",
            "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent active:bg-surface-muted",
            item.active ? "font-semibold text-foreground" : "text-muted",
          )}
        >
          {item.active ? <span aria-hidden className="absolute inset-x-5 top-0 h-[2px] rounded-b-full bg-accent" /> : null}
          <span aria-hidden className={cn("flex [&>svg]:size-5", item.active ? "text-accent" : undefined)}>
            {item.icon}
          </span>
          <span className="max-w-full truncate">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
