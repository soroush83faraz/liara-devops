"use client";

import { useEffect, useRef } from "react";
import { Database, Network, Plus, Server } from "lucide-react";
import { Button } from "@/components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { openAppDialog, openDbDialog, openNetworkDialog, useCreateStore } from "@/lib/create/store";
import { tk } from "./parts";
import { CreateHost } from "./create-host";

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
          <Button ref={triggerRef} size="sm" aria-label={tk("menu.addAria")}>
            <Plus aria-hidden className="size-4" />
            {tk("menu.add")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={from(() => openNetworkDialog())}>
            <Network aria-hidden className="size-4 text-muted" />
            <span className="flex flex-col leading-6">
              <span>{tk("menu.network")}</span>
              <span className="text-xs text-muted">{tk("menu.networkHint")}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={from(() => openAppDialog())}>
            <Server aria-hidden className="size-4 text-muted" />
            <span className="flex flex-col leading-6">
              <span>{tk("menu.app")}</span>
              <span className="text-xs text-muted">{tk("menu.appHint")}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={from(() => openDbDialog())}>
            <Database aria-hidden className="size-4 text-muted" />
            <span className="flex flex-col leading-6">
              <span>{tk("menu.db")}</span>
              <span className="text-xs text-muted">{tk("menu.dbHint")}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateHost />
    </>
  );
}
