"use client";

import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { DIR } from "./dir";

export function DropdownMenu(props: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root dir={DIR} {...props} />;
}
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuLabel = ({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) => (
  <MenuPrimitive.Label className={cn("px-2.5 py-1.5 text-xs text-muted", className)} {...props} />
);

export function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 max-w-[calc(100vw-2rem)] origin-(--radix-dropdown-menu-content-transform-origin) rounded-md border border-border bg-surface p-1.5 text-foreground shadow-[var(--shadow-pop)] animate-hl-pop",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 text-sm outline-none transition-colors duration-100 md:min-h-9",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        danger
          ? "text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger-ink"
          : "data-[highlighted]:bg-surface-muted data-[highlighted]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) => (
  <MenuPrimitive.Separator className={cn("-mx-1.5 my-1.5 h-px bg-border", className)} {...props} />
);
