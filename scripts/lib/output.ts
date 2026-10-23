import { isLiaraError } from "../../lib/liara";
import { redactDeep, redactString } from "../../lib/security/redact";
import { GuardError, UsageError } from "./args";
import { EXIT } from "./guards";

/** Redacts anything that looks like a secret before it reaches stdout/stderr or a report file. */
export function redactForOutput<T>(value: T, knownSecrets: readonly string[] = []): T {
  return redactDeep(value, { knownSecrets });
}

export const redactLine = (line: string, knownSecrets: readonly string[] = []): string => redactString(line, { knownSecrets });

export interface ErrorReport {
  exitCode: number;
  message: string;
}

/** Maps any thrown value to an exit code and a redacted one-line message (never a token or an env value). */
export function describeError(e: unknown, knownSecrets: readonly string[] = []): ErrorReport {
  if (e instanceof UsageError) return { exitCode: EXIT.usage, message: `usage error: ${e.message}` };
  if (e instanceof GuardError) return { exitCode: EXIT.guard, message: `refused: ${e.message}` };
  if (isLiaraError(e)) {
    const code = e.code ? ` code=${e.code}` : "";
    return { exitCode: EXIT.liara, message: redactLine(`Liara error kind=${e.kind}${code} status=${e.status}: ${e.message}`, knownSecrets) };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { exitCode: EXIT.liara, message: redactLine(`unexpected error: ${msg.slice(0, 300)}`, knownSecrets) };
}
