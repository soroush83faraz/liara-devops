// Shared harness for the actions tests (synthetic data only, no live Liara calls).
import type { ActionParams } from "../../../lib/contracts/action";
import { costFromHourly } from "../../../lib/contracts/common";
import type { Proposal, ProposalSource } from "../../../lib/contracts/proposal";
import type { ProbeResult } from "../../../lib/canvas/types";
import { computeTargetFingerprint } from "../../../lib/actions/fingerprint";
import type { HttpDeps, RouteCtx } from "../../../lib/actions/http/common";
import { ACTION_POLICY, actionTarget } from "../../../lib/contracts/action";
import { createProposal } from "../../../lib/security/state-machine";
import { createMemoryStore, type Store } from "../../../lib/security/store";
import { FakeLiara, fakeClock } from "./fake-liara";

export const KEY = Buffer.alloc(32, 7);
export const ORIGIN = "http://localhost:3000";

let n = 0;
/** Unique per test: the rate limiter, target locks and the event bus are process-wide. */
export const newAccount = () => `acct_t${++n}_${Math.random().toString(36).slice(2, 10)}`;

export interface TestEnv {
  clock: ReturnType<typeof fakeClock>;
  liara: FakeLiara;
  store: Store;
  deps: HttpDeps;
  jobs: Promise<void>[];
  accountId: string;
  teamId: string;
  probes: { statuses: Array<number | "no_url" | "refused">; calls: number };
  settle: () => Promise<void>;
}

export function setup(opts: { store?: Store; teamId?: string } = {}): TestEnv {
  const clock = fakeClock();
  const liara = new FakeLiara(clock);
  const store = opts.store ?? createMemoryStore();
  const jobs: Promise<void>[] = [];
  const probes: TestEnv["probes"] = { statuses: [200], calls: 0 };
  const probe = async (): Promise<ProbeResult> => {
    const s = probes.statuses[Math.min(probes.calls, probes.statuses.length - 1)];
    probes.calls++;
    const checkedAt = new Date(clock.now()).toISOString();
    if (s === "no_url" || s === "refused") return { ok: false, error: s, latencyMs: 1, checkedAt };
    return { ok: s < 400, status: s, latencyMs: 5, checkedAt };
  };
  const deps: HttpDeps = {
    store,
    now: clock.now,
    tokenKey: KEY,
    allowedOrigins: [ORIGIN],
    schedule: (job) => {
      jobs.push(job());
    },
    verify: { probe, sleep: clock.sleep, now: clock.now, wait: { timeoutMs: 60_000, pollMs: 3_000 } },
    deployTiming: { watchTimeoutMs: 5_000, queueIntervalMs: 0, logIntervalMs: 0 },
  };
  return {
    clock,
    liara,
    store,
    deps,
    jobs,
    accountId: newAccount(),
    teamId: opts.teamId ?? "",
    probes,
    settle: async () => {
      await Promise.all(jobs);
    },
  };
}

export function ctxFor(
  env: TestEnv,
  opts: { body?: unknown; method?: string; headers?: Record<string, string>; path?: string; teamId?: string; rawBody?: string } = {},
): RouteCtx {
  const teamId = opts.teamId ?? env.teamId;
  const method = opts.method ?? "POST";
  const headers: Record<string, string> = {
    host: "localhost:3000",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    ...(method !== "GET" ? { "content-type": "application/json" } : {}),
    ...opts.headers,
  };
  const body = method === "GET" ? undefined : (opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)));
  return {
    session: { token: "tok_SYNTHETIC", accountId: env.accountId, ...(teamId ? { teamId } : {}) },
    liara: env.liara.client({ teamId }),
    request: new Request(`${ORIGIN}${opts.path ?? "/api/test"}`, { method, headers, body }),
  };
}

/** Creates and stores a proposal exactly like the agent/setup units do (createProposal + shared fingerprint). */
export async function propose(env: TestEnv, params: ActionParams, over: { source?: ProposalSource; teamId?: string; ttlMs?: number } = {}): Promise<Proposal> {
  const policy = ACTION_POLICY[params.type];
  const source: ProposalSource = over.source ?? (policy.aiProposable ? "agent" : "user");
  const stateFingerprint = await computeTargetFingerprint(env.liara.client({ teamId: over.teamId ?? env.teamId }), actionTarget(params));
  const proposal = createProposal(
    {
      accountId: env.accountId,
      params,
      source,
      rationaleFa: "دلیل آزمایشی",
      evidenceIds: source === "agent" ? ["O1"] : [],
      effectFa: "اثر آزمایشی",
      risksFa: [],
      verificationPlan: ["probe"],
      costEstimate: policy.billed ? costFromHourly(100) : undefined,
      stateFingerprint,
      ttlMs: over.ttlMs,
    },
    env.clock.now(),
  );
  await env.store.proposals.put(env.accountId, proposal.id, proposal);
  return proposal;
}

export async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
