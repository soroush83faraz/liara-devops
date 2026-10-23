// The ONLY place in lib/actions that writes to the console. It accepts a fixed event code and prints the
// error's class name (and a snake_case code when present) — never messages, params, values or bodies.
// tests/unit/actions/no-console.test.ts enforces that no other file under lib/actions uses `console`.
export type SafeLogEvent =
  | "audit_append_failed"
  | "job_failed"
  | "job_transition_failed"
  | "incident_update_failed"
  | "bus_listener_failed"
  | "stuck_reconcile_failed";

const SAFE_CODE = /^[a-z0-9_]{1,40}$/;

export function safeLog(event: SafeLogEvent, err?: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  const raw = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  const code = typeof raw === "string" && SAFE_CODE.test(raw) ? raw : undefined;
  console.error(`[actions] ${event}`, code ? `${name}:${code}` : name);
}
