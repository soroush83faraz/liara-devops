"use client";

import { useEffect, useRef } from "react";
import { Database, Network, Plus, Server } from "lucide-react";
import { Button } from "@/components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { openAppDialog, openDbDialog, openNetworkDialog, useCreateStore } from "@/lib/create/store";
import { cn } from "@/lib/utils";
import { tk } from "./parts";
import { CreateHost } from "./create-host";

/** Two-line items (name + hint): roomy rows with an icon tile, so the three choices read as separate options. */
const ITEM = "group/item items-start gap-3 py-2.5 md:min-h-0";
const ICON_TILE =
  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-muted text-muted transition-colors duration-100 group-data-[highlighted]/item:border-accent/30 group-data-[highlighted]/item:bg-accent-soft group-data-[highlighted]/item:text-accent-ink";

/**
 * Phones: the trigger sits in the page header next to icon-only buttons. It keeps its 44 px touch target but draws a
 * 32 px fill inside it (a pseudo-element), so it reads as the primary action without outweighing the row.
 */
const MOBILE_TRIGGER = cn(
  "max-md:bg-transparent max-md:shadow-none max-md:hover:bg-transparent max-md:hover:shadow-none [&>svg]:relative",
  "max-md:before:absolute max-md:before:inset-1.5 max-md:before:rounded-sm max-md:before:bg-accent max-md:before:transition-colors max-md:hover:before:bg-accent/88",
);

/** «+ افزودن» dropdown for the canvas toolbar. Also mounts the dialog host so the dialogs exist on the canvas page. */
export function CreateMenu() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedHere = useRef(false);
  const isOpen = useCreateStore((s) => s.dialog !== null);

  // The dialogs open from a menu item that is unmounted by then, so Radix has no trigger to give focus back to
  // (it would fall to <body>). When a dialog this menu opened closes, return focus to the «+ افزودن» trigger.
  useEffect(() => {
    if (isOpen || !openedHere.current) return;
    openedHere.current = false;
    const id = window.setTimeout(() => triggerRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  const from = (open: () => void) => () => {
    openedHere.current = true;
    open();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} size="sm" aria-label={tk("menu.addAria")} className={MOBILE_TRIGGER}>
            <Plus aria-hidden className="size-4" />
            {tk("menu.add")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="flex w-72 flex-col gap-1">
          <DropdownMenuItem onSelect={from(() => openNetworkDialog())} className={ITEM}>
            <span aria-hidden className={ICON_TILE}>
              <Network className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium leading-5">{tk("menu.network")}</span>
              <span className="text-xs leading-5 text-muted">{tk("menu.networkHint")}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={from(() => openAppDialog())} className={ITEM}>
            <span aria-hidden className={ICON_TILE}>
              <Server className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium leading-5">{tk("menu.app")}</span>
              <span className="text-xs leading-5 text-muted">{tk("menu.appHint")}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={from(() => openDbDialog())} className={ITEM}>
            <span aria-hidden className={ICON_TILE}>
              <Database className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium leading-5">{tk("menu.db")}</span>
              <span className="text-xs leading-5 text-muted">{tk("menu.dbHint")}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateHost />
    </>
  );
}
