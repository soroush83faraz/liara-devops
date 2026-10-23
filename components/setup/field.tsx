import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Label + control + help/error, wired with aria-describedby. `children` receives the ids to put on the control. */
export function Field({
  label,
  help,
  error,
  className,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium leading-7">
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <p id={errorId} role="alert" className="text-sm leading-6 text-danger">
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} className="text-xs leading-6 text-muted">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h3 className="text-base font-semibold leading-8">{title}</h3>
      {children}
    </section>
  );
}
