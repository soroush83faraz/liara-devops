// The one way executors send a mutation to Liara: exactly once, never retried. When the outcome is unknown
// (timeout, lost connection, 5xx, unreadable 2xx) the real state is re-read before anything is reported.
import { isLiaraError } from "@/lib/liara";
import { ActionError, fromLiaraError, isUncertainMutationError, type SafeValue } from "./errors";

export interface Reread {
  /** True when the re-read state proves the intended change is in place. */
  confirmed: boolean;
  /** Secret-free snapshot of what was read. */
  after?: Record<string, unknown>;
}

export interface MutationResult<T> {
  value?: T;
  /** The call itself failed ambiguously but the re-read shows the change applied. */
  confirmedByReread: boolean;
  after?: Record<string, unknown>;
}

export async function mutateOnce<T>(step: string, send: () => Promise<T>, reread: () => Promise<Reread>): Promise<MutationResult<T>> {
  try {
    return { value: await send(), confirmedByReread: false };
  } catch (e) {
    if (e instanceof ActionError) throw e;
    if (!isUncertainMutationError(e)) {
      if (isLiaraError(e)) throw fromLiaraError(e, step);
      throw e;
    }
    // SECURITY/RELIABILITY: no retry here — a lost response may still have been applied.
    let state: Reread | undefined;
    try {
      state = await reread();
    } catch {
      state = undefined;
    }
    if (state?.confirmed) return { confirmedByReread: true, after: state.after };
    const details: Record<string, SafeValue> = { step, reread: state ? "not_confirmed" : "failed" };
    throw new ActionError("outcome_unknown", { details, after: state?.after });
  }
}
