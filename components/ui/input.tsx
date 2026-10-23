import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

const fieldBase = [
  "block w-full rounded-lg border bg-surface px-3 text-[15px] text-foreground",
  "placeholder:text-muted transition-colors",
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent focus-visible:border-accent",
  "disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-surface-muted",
];

export const fieldClass = (invalid?: boolean) =>
  cn(fieldBase, invalid ? "border-danger" : "border-border-strong");

export interface InputProps extends ComponentProps<"input"> {
  invalid?: boolean;
}

export function Input({ className, invalid, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(fieldClass(invalid), "min-h-11 md:min-h-10", className)}
      {...props}
    />
  );
}

export interface TextareaProps extends ComponentProps<"textarea"> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldClass(invalid), "min-h-24 py-2 leading-7", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/**
 * Label + control + hint/error wiring.
 * <Field label="..." error={e}>{(p) => <Input {...p} />}</Field>
 */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="ms-2 text-xs font-normal text-muted">({t("common.optional")})</span> : null}
      </Label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="text-xs leading-6 text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm leading-6 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
