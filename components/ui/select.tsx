"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";
import { DIR } from "./dir";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

export function Select({
  options,
  placeholder,
  invalid,
  className,
  id,
  disabled,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  ...root
}: SelectProps) {
  return (
    <SelectPrimitive.Root dir={DIR} disabled={disabled} {...root}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn(
          fieldClass(invalid),
          "group/select inline-flex min-h-11 items-center justify-between gap-2 text-start md:min-h-10",
          "data-[placeholder]:text-muted",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden className="size-4 text-muted transition-transform duration-200 group-data-[state=open]/select:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          dir={DIR}
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-md border border-border bg-surface text-foreground shadow-[var(--shadow-pop)] animate-hl-pop"
        >
          <SelectPrimitive.Viewport className="p-1.5">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex min-h-11 cursor-pointer select-none items-center rounded-sm ps-8 pe-3 text-sm outline-none transition-colors duration-100 data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted data-[state=checked]:font-semibold md:min-h-9"
              >
                <SelectPrimitive.ItemIndicator className="absolute start-2 text-accent">
                  <Check aria-hidden className="size-4" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
