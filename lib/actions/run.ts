// Shared execution context for the executors: the Liara client, options, the secret set and a step sink
// whose details are redacted with every secret known so far before they leave the executor.
import type { LiaraClient } from "@/lib/liara";
import type { ProposalSource } from "@/lib/contracts/proposal";
import type { StepStatus } from "@/lib/contracts/stream";
import { redactString } from "@/lib/security/redact";
import type { StoredSource } from "@/lib/setup/source-store";
import { ActionError } from "./errors";
import { SecretSet } from "./secrets";

export interface ExecContext {
  liara: LiaraClient;
  /** From the session only. */
  accountId: string;
}

export interface StepEvent {
  /** Matches the contract's execution step code (`[A-Za-z0-9_.:-]{1,64}`). */
  step: string;
  status: StepStatus;
  detail?: string;
}
export type StepSink = (event: StepEvent) => void;

export interface DeployTiming {
  /** Bound for waiting on a release (default 15 min). */
  watchTimeoutMs?: number;
  queueIntervalMs?: number;
  logIntervalMs?: number;
}

export interface ExecOptions {
  /** Values for `valueSource: 'user'` env keys. Request-scoped: never stored, logged or echoed. */
  userValues?: Readonly<Record<string, string>>;
  source: ProposalSource;
  signal?: AbortSignal;
  onStep?: StepSink;
  deploy?: DeployTiming;
  getSource?: (accountId: string, ref: string) => Promise<StoredSource | null>;
}

export interface ExecResult {
  /** Secret-free, redacted. */
  summary: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Every secret value the operation touched; pass to appendAudit / redaction. */
  knownSecrets: string[];
  /** The call failed ambiguously but a re-read proved the change. */
  confirmedByReread?: boolean;
}

const STEP_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const DETAIL_MAX = 500;

export class Run {
  readonly secrets = new SecretSet();
  confirmedByReread = false;

  /**
   * @param publicNames resource names / env keys of this operation. An env value equal to one of them (e.g. a
   * DB_HOST value equal to the DB hostname) is already public, so it is not scrubbed from summaries.
   */
  constructor(
    readonly ctx: ExecContext,
    readonly opts: ExecOptions,
    private readonly publicNames: ReadonlySet<string> = new Set(),
  ) {}

  get liara(): LiaraClient {
    return this.ctx.liara;
  }

  knownSecrets(): string[] {
    return this.secrets.list().filter((v) => !this.publicNames.has(v));
  }

  step(step: string, status: StepStatus, detail?: string): void {
    const sink = this.opts.onStep;
    if (!sink || !STEP_RE.test(step)) return;
    const safe = detail === undefined ? undefined : redactString(detail, { knownSecrets: this.knownSecrets() }).slice(0, DETAIL_MAX);
    try {
      sink(safe ? { step, status, detail: safe } : { step, status });
    } catch {
      // a failing progress sink must never change the outcome of a mutation
    }
  }

  assertNotAborted(): void {
    if (this.opts.signal?.aborted) throw new ActionError("aborted");
  }
}
