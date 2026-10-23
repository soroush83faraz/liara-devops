// Deterministic MOCK of the copilot backend for development and tests. DEV ONLY: lib/copilot/http.ts imports this
// module dynamically behind `NODE_ENV !== "production"`, so production bundles never contain it.
// Everything is synthetic (built from lib/contracts/fixtures.ts) and says so in the UI; it is never evidence that
// Liara integration works. Mock "approval tokens" are not real tokens and prove nothing about the real server.
import {
  ACTION_POLICY,
  checkUserEnvValues,
  userValueKeys,
  type AuditEntry,
  type Finding,
  type Incident,
  type Observation,
  type Proposal,
  type Verification,
} from "@/lib/contracts";
import {
  failingFinding,
  healthyFinding,
  proposedSetEnv,
  sampleIncident,
  sampleNotVerified,
  sampleVerification,
} from "@/lib/contracts/fixtures";
import { mockStreamCopy } from "@/lib/i18n/mock-stream-copy";

const m = mockStreamCopy;

export const MOCK_SCENARIO_IDS = [
  "s1",
  "healthy",
  "insufficient",
  "partial",
  "llm_down",
  "not_verified",
  "injection",
  "declined",
  "stale",
] as const;
export type MockScenarioId = (typeof MOCK_SCENARIO_IDS)[number];

export function isMockScenarioId(v: unknown): v is MockScenarioId {
  return typeof v === "string" && (MOCK_SCENARIO_IDS as readonly string[]).includes(v);
}

export interface MockStep {
  delayMs: number;
  chunk: unknown;
}

export interface MockTarget {
  kind: "app" | "db";
  name: string;
}

/** Scenario for a question: explicit override first, then keywords from the suggested chips. */
export function pickScenario(userText: string, override?: string): MockScenarioId {
  if (isMockScenarioId(override)) return override;
  if (new RegExp(m.keywords.declined, "i").test(userText)) return "declined";
  if (new RegExp(m.keywords.slow, "i").test(userText)) return "insufficient";
  if (new RegExp(m.keywords.healthy, "i").test(userText)) return "healthy";
  return "s1";
}

/* ------------------------------------------------------------- helpers */

const FIXTURE_BASE_MS = Date.parse("2026-10-22T08:00:00.000Z");

/** 64 lowercase hex chars derived from a seed (stand-in for sha256; the UI never verifies hashes). */
export function hex64(seed: string): string {
  let out = "";
  for (let round = 0; round < 8; round++) {
    let h = (0x811c9dc5 ^ (round * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

function retarget<T>(value: T, name: string): T {
  return JSON.parse(JSON.stringify(value).replaceAll("broken-shop", name)) as T;
}

function makeShift(now: Date) {
  const delta = now.getTime() - FIXTURE_BASE_MS;
  return (iso: string) => new Date(Math.min(now.getTime(), Date.parse(iso) + delta)).toISOString();
}

function shiftObservation(o: Observation, shift: (iso: string) => string): Observation {
  return o.ts ? { ...o, ts: shift(o.ts) } : o;
}

function shiftFinding(f: Finding, name: string, now: Date): Finding {
  const shift = makeShift(now);
  const base = retarget(f, name);
  return { ...base, facts: base.facts.map((o) => shiftObservation(o, shift)) };
}

const iso = (ms: number) => new Date(ms).toISOString();

const dataChunk = (type: string, data: unknown, id?: string) => ({ type: `data-${type}`, ...(id ? { id } : {}), data });
const stepChunk = (id: string, label: string, status: "pending" | "running" | "done" | "failed" | "skipped", detail?: string) =>
  dataChunk("step", { id, label, status, ...(detail ? { detail } : {}) }, id);

/* ------------------------------------------------------------ scenarios */

function dbFacts(name: string, now: Date): Observation[] {
  return [
    {
      id: "O1",
      kind: "db_state",
      severity: "error",
      ts: iso(now.getTime() - 4 * 60_000),
      source: "liara:db",
      summary: "evidence.db.stopped",
      text: `database ${name} scale=0 (stopped)`,
      params: { hostname: name, scale: 0 },
    },
    {
      id: "O2",
      kind: "connection_error",
      severity: "error",
      ts: iso(now.getTime() - 3 * 60_000),
      source: "liara:logs",
      summary: "evidence.connection.refused",
      text: `Error: connect ECONNREFUSED ${name}:5432`,
      params: { host: name, count: 12 },
    },
  ];
}

function dbFinding(name: string, now: Date): Finding {
  return {
    facts: dbFacts(name, now),
    hypotheses: [
      {
        id: "H1",
        titleFa: m.dbStoppedTitle,
        explanationFa: m.dbStoppedBody,
        supports: ["O1", "O2"],
        contradicts: [],
        level: "medium",
        levelReason: { rule: "signature_only", signature: true, correlation: false, contradicted: false },
        actionHint: "scale",
      },
    ],
    ruledOut: [],
    unknowns: [],
  };
}

function insufficientFinding(name: string, now: Date): Finding {
  const shift = makeShift(now);
  const raw: Observation[] = [
    {
      id: "O1",
      kind: "probe",
      severity: "warn",
      ts: "2026-10-22T07:59:00.000Z",
      source: "probe",
      summary: "evidence.probe.slow",
      text: "GET https://broken-shop.liara.run/ -> 200 (4120 ms)",
      params: { status: 200, latencyMs: 4120 },
    },
    {
      id: "O2",
      kind: "metric",
      severity: "info",
      ts: "2026-10-22T07:58:00.000Z",
      source: "liara:metrics",
      summary: "evidence.metric.memory",
      text: "memory 38% of limit (avg 15 min)",
      params: { percent: 38, windowMin: 15 },
    },
  ];
  const facts = retarget(raw, name).map((o) => shiftObservation(o, shift));
  return {
    facts,
    hypotheses: [
      {
        id: "H1",
        titleFa: m.insufficientH1Title,
        explanationFa: m.insufficientH1Body,
        supports: [],
        contradicts: [],
        level: "insufficient",
        levelReason: { rule: "no_support", signature: false, correlation: false, contradicted: false },
      },
    ],
    ruledOut: [{ titleFa: m.insufficientRuledOut, reasonFa: m.insufficientRuledOutWhy, observationIds: ["O2"] }],
    unknowns: [
      { descriptionFa: m.insufficientUnknown1, howToGet: m.insufficientUnknown1How },
      { descriptionFa: m.insufficientUnknown2, howToGet: m.insufficientUnknown2How },
    ],
    limitsNote: failingFinding.limitsNote,
  };
}

function partialFinding(name: string, now: Date): Finding {
  const base = shiftFinding(failingFinding, name, now);
  const keep = new Set(["O2", "O3", "O4", "O5"]);
  return {
    facts: base.facts.filter((o) => keep.has(o.id)),
    hypotheses: [
      {
        id: "H1",
        titleFa: m.partialH1Title,
        explanationFa: m.partialH1Body,
        supports: ["O2", "O4"],
        contradicts: [],
        level: "medium",
        levelReason: { rule: "correlation_only", signature: false, correlation: true, contradicted: false },
        actionHint: "set_env",
      },
    ],
    ruledOut: [],
    unknowns: [{ descriptionFa: m.partialUnknown, howToGet: m.partialUnknownHow }],
    limitsNote: [m.partialLimit],
  };
}

function injectionFinding(name: string, now: Date): Finding {
  const base = shiftFinding(failingFinding, name, now);
  const flagged: Observation = {
    id: "O6",
    kind: "log_error",
    severity: "warn",
    ts: iso(now.getTime() - 90_000),
    source: "liara:logs",
    summary: "evidence.injection.suspect",
    text: m.injectionText,
    params: { count: 1 },
    flagged: true,
  };
  return { ...base, facts: [...base.facts, flagged] };
}

function llmDownFinding(name: string, now: Date): Finding {
  const base = shiftFinding(failingFinding, name, now);
  // Rule-only findings carry the deterministic template text, not model prose.
  return {
    ...base,
    hypotheses: base.hypotheses.map((h) => ({ ...h, explanationFa: h.titleFa })),
    unknowns: [],
  };
}

function healthyFindingFor(name: string, now: Date): Finding {
  return shiftFinding(healthyFinding, name, now);
}

export function mockFindingFor(scenario: MockScenarioId, target: MockTarget, now: Date): Finding {
  if (target.kind === "db") {
    return scenario === "healthy" ? healthyFindingFor(target.name, now) : dbFinding(target.name, now);
  }
  switch (scenario) {
    case "healthy":
      return healthyFindingFor(target.name, now);
    case "insufficient":
      return insufficientFinding(target.name, now);
    case "partial":
      return partialFinding(target.name, now);
    case "injection":
      return injectionFinding(target.name, now);
    case "llm_down":
      return llmDownFinding(target.name, now);
    default:
      return shiftFinding(failingFinding, target.name, now);
  }
}

export function mockProposalFor(target: MockTarget, id: string, now: Date, evidenceIds?: string[]): Proposal {
  const created = now.getTime();
  const base = {
    ...proposedSetEnv,
    id,
    status: "proposed" as const,
    createdAt: iso(created),
    expiresAt: iso(created + 10 * 60_000),
    updatedAt: iso(created),
    history: [{ status: "proposed" as const, at: iso(created) }],
    idempotencyKey: `idk_${hex64(id).slice(0, 40)}`,
    stateFingerprint: hex64(`state:${target.name}`),
  };
  if (target.kind === "db") {
    return {
      ...base,
      type: "scale",
      target: { kind: "db", name: target.name },
      params: { type: "scale", resource: { kind: "db", name: target.name }, scale: 1 },
      rationaleFa: m.dbStoppedRationale,
      evidenceIds: ["O1", "O2"],
      effectFa: m.dbStoppedEffect,
      risksFa: [m.dbStoppedRisk],
      reversible: "yes",
      verificationPlan: [m.dbVerifyPlan],
      paramsHash: hex64(`scale:${target.name}`),
    };
  }
  const retargeted = retarget(base, target.name);
  return {
    ...retargeted,
    evidenceIds: evidenceIds ?? retargeted.evidenceIds,
    paramsHash: target.name === "broken-shop" ? proposedSetEnv.paramsHash : hex64(`set_env:${target.name}`),
  };
}

export interface MockAgentPlan {
  scenario: MockScenarioId;
  steps: MockStep[];
  proposal?: Proposal;
  incident?: Incident;
}

const D = 380;

/** The whole agent stream for a scenario, in emission order. Pure and deterministic for a fixed `now`. */
export function buildAgentPlan(args: { scenario: MockScenarioId; target: MockTarget; now: Date; proposalId: string; incidentId: string }): MockAgentPlan {
  const { scenario, target, now, proposalId, incidentId } = args;
  const steps: MockStep[] = [];
  const push = (chunk: unknown, delayMs = D) => steps.push({ delayMs, chunk });
  const textChunks = (id: string, text: string) => {
    push({ type: "text-start", id }, 120);
    const words = text.split(" ");
    for (let i = 0; i < words.length; i += 4) {
      push({ type: "text-delta", id, delta: `${words.slice(i, i + 4).join(" ")}${i + 4 < words.length ? " " : ""}` }, 60);
    }
    push({ type: "text-end", id }, 40);
  };

  push({ type: "start", messageId: `mock-${scenario}` }, 60);
  push({ type: "start-step" }, 20);

  if (scenario === "declined") {
    textChunks("t-declined", m.declined);
    push({ type: "finish-step" }, 20);
    push({ type: "finish" }, 20);
    return { scenario, steps };
  }

  const isDb = target.kind === "db";
  const stepDefs = isDb
    ? ([["s_db", m.step.db]] as const)
    : ([
        ["s_app", m.step.app],
        ["s_logs", m.step.logs],
        ["s_releases", m.step.releases],
        ["s_probe", m.step.probe],
      ] as const);
  for (const [id, label] of stepDefs) {
    push(stepChunk(id, label, "running"));
    if (id === "s_logs" && scenario === "partial") push(stepChunk(id, label, "failed", m.step.logsFailed));
    else push(stepChunk(id, label, "done"));
  }

  const finding = mockFindingFor(scenario, target, now);
  for (const o of finding.facts) push(dataChunk("observation", o, o.id), 160);

  push(stepChunk("s_analyze", m.step.analyze, "running"));
  if (scenario === "llm_down") {
    push(dataChunk("error", { code: "agent.llm_unavailable", messageFa: m.llmDown }), 200);
  } else {
    textChunks("t-summary", scenario === "healthy" ? m.summaryHealthy : m.summaryS1);
  }
  push(dataChunk("finding", finding, "finding"), 300);
  push(stepChunk("s_analyze", m.step.analyze, "done"), 120);

  const wantsProposal = scenario !== "healthy" && scenario !== "insufficient";
  let proposal: Proposal | undefined;
  let incident: Incident | undefined;
  if (wantsProposal) {
    proposal = mockProposalFor(target, proposalId, now, scenario === "partial" ? ["O2", "O4"] : undefined);
    incident = {
      id: incidentId,
      accountId: sampleIncident.accountId,
      target: proposal.target,
      startedAt: finding.facts[0]?.ts ?? iso(now.getTime()),
      finding,
      proposalId,
      timeline: [
        { ts: iso(now.getTime()), kind: "detected" },
        { ts: iso(now.getTime()), kind: "proposed", refId: proposalId },
      ],
    };
    push(dataChunk("incident", incident, incidentId), 120);
    push(dataChunk("proposal", proposal, proposalId), 250);
  }
  push({ type: "finish-step" }, 20);
  push({ type: "finish" }, 20);
  return { scenario, steps, proposal, incident };
}

/** Execution + verification events after approval (the `/events` stream). */
export function buildExecutionPlan(proposal: Proposal, scenario: MockScenarioId): MockStep[] {
  const stepCodes = proposal.type === "set_env" ? ["read_envs", "merge", "send", "readback", "restarting", "waiting"] : ["send", "waiting"];
  const steps: MockStep[] = [];
  for (const code of stepCodes) {
    steps.push({ delayMs: 500, chunk: dataChunk("execution", { proposalId: proposal.id, step: code, status: "running" }, `exec-${code}`) });
    steps.push({ delayMs: 650, chunk: dataChunk("execution", { proposalId: proposal.id, step: code, status: "done" }, `exec-${code}`) });
  }
  const result: Verification =
    scenario === "not_verified"
      ? sampleNotVerified
      : proposal.type === "set_env"
        ? sampleVerification
        : {
            checks: [{ name: "db_state", passed: true, status: "passed", detail: m.dbCheckRunning }],
            outcome: "verified",
            before: { appStatus: "stopped" },
            after: { appStatus: "running" },
          };
  steps.push({ delayMs: 900, chunk: dataChunk("verification", { proposalId: proposal.id, result }, `verif-${proposal.id}`) });
  return steps;
}

/* ---------------------------------------------------------- mock server */

type Stage = "proposed" | "approved" | "executing" | "verifying" | "verified" | "not_verified" | "failed" | "rejected";

interface MockProposalState {
  proposal: Proposal;
  scenario: MockScenarioId;
  incidentId?: string;
  stage: Stage;
  token?: string;
  plan?: MockStep[];
  cursor: number;
}

const proposals = new Map<string, MockProposalState>();
const incidents = new Map<string, Incident>();
let seq = 0;

/** Test helper: forget all mock server state. */
export function resetMockServer(): void {
  forcedScenario = undefined;
  proposals.clear();
  incidents.clear();
  seq = 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errorJson = (status: number, code: string, retryAfterSec?: number) =>
  json(status, { error: { code, ...(retryAfterSec ? { retryAfterSec } : {}) } });

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

function sseResponse(signal: AbortSignal | undefined, run: (emit: (chunk: unknown) => void, closed: () => boolean) => Promise<void>): Response {
  const enc = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const closed = () => cancelled || signal?.aborted === true;
      const emit = (chunk: unknown) => {
        if (!closed()) controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      try {
        await run(emit, closed);
        if (!closed()) controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by cancel/abort
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

function stageOf(state: MockProposalState): Stage {
  return state.stage;
}

function currentProposal(state: MockProposalState): Proposal {
  const status = stageOf(state);
  return { ...state.proposal, status, updatedAt: new Date().toISOString() };
}

function lastUserText(body: { messages?: Array<{ role?: string; parts?: Array<{ text?: string }> }> }): string {
  const last = [...(body.messages ?? [])].reverse().find((x) => x.role === "user");
  return last?.parts?.map((p) => p.text ?? "").join(" ") ?? "";
}

let forcedScenario: string | undefined;

/** Test hook: pins the scenario regardless of the question (no window in node tests). */
export function forceMockScenario(id: string | undefined): void {
  forcedScenario = id;
}

function scenarioOverride(): string | undefined {
  if (forcedScenario) return forcedScenario;
  if (typeof window === "undefined") return undefined;
  try {
    return new URLSearchParams(window.location.search).get("scenario") ?? window.sessionStorage.getItem("hl.copilotScenario") ?? undefined;
  } catch {
    return undefined;
  }
}

async function handleAgent(init: RequestInit | undefined): Promise<Response> {
  let body: { messages?: Array<{ role?: string; parts?: Array<{ text?: string }> }>; target?: MockTarget } = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}"));
  } catch {
    return errorJson(400, "bad_request");
  }
  const target = body.target;
  if (!target || (target.kind !== "app" && target.kind !== "db") || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(target.name)) {
    return errorJson(400, "bad_target");
  }
  const override = scenarioOverride();
  const scenario = pickScenario(lastUserText(body), override === "auto" ? undefined : override);
  seq += 1;
  const proposalId = `p_mock_${String(seq).padStart(4, "0")}`;
  const incidentId = `inc_mock_${String(seq).padStart(4, "0")}`;
  const plan = buildAgentPlan({ scenario, target, now: new Date(), proposalId, incidentId });
  if (plan.proposal) {
    proposals.set(proposalId, { proposal: plan.proposal, scenario, incidentId, stage: "proposed", cursor: 0 });
  }
  if (plan.incident) incidents.set(incidentId, plan.incident);
  const signal = init?.signal ?? undefined;
  return sseResponse(signal, async (emit, closed) => {
    for (const step of plan.steps) {
      await sleep(step.delayMs, signal ?? undefined);
      if (closed()) return;
      emit(step.chunk);
    }
  });
}

function handleApprove(id: string, init: RequestInit | undefined): Response {
  const state = proposals.get(id);
  if (!state) return errorJson(404, "proposal.not_found");
  if (state.scenario === "stale") return errorJson(409, "proposal.stale");
  if (state.stage !== "proposed") return errorJson(409, "proposal.invalid_state");
  if (Date.now() > Date.parse(state.proposal.expiresAt)) return errorJson(410, "proposal.expired");
  let typedName: unknown;
  try {
    typedName = (JSON.parse(String(init?.body ?? "{}")) as { typedName?: unknown }).typedName;
  } catch {
    return errorJson(400, "bad_request");
  }
  if (ACTION_POLICY[state.proposal.type].requiresTypedName && typedName !== state.proposal.target.name) {
    return errorJson(400, "typed_name_mismatch");
  }
  state.stage = "approved";
  state.token = `mock-${hex64(`${id}:${state.cursor}`).slice(0, 24)}`;
  return json(200, { approvalToken: state.token, expiresAt: new Date(Date.now() + 60_000).toISOString(), proposal: currentProposal(state) });
}

function handleExecute(id: string, init: RequestInit | undefined): Response {
  const state = proposals.get(id);
  if (!state) return errorJson(404, "proposal.not_found");
  let body: { approvalToken?: unknown; userValues?: Record<string, string> };
  try {
    body = JSON.parse(String(init?.body ?? "{}"));
  } catch {
    return errorJson(400, "bad_request");
  }
  if (state.stage !== "approved" || body.approvalToken !== state.token) return errorJson(403, "token.invalid");
  const required = userValueKeys(state.proposal.params);
  const cover = checkUserEnvValues(required, body.userValues ?? {});
  if (!cover.ok) return errorJson(400, "user_values.mismatch");
  state.token = undefined; // one-time
  state.stage = "executing";
  state.plan = buildExecutionPlan(state.proposal, state.scenario);
  state.cursor = 0;
  return json(202, { accepted: true });
}

function applyEmitted(state: MockProposalState, chunk: unknown): void {
  const c = chunk as { type: string; data?: { result?: Verification; status?: string; step?: string } };
  if (c.type === "data-verification" && c.data?.result) {
    state.stage = c.data.result.outcome;
    const inc = state.incidentId ? incidents.get(state.incidentId) : undefined;
    if (state.incidentId && inc) {
      incidents.set(state.incidentId, {
        ...inc,
        verification: c.data.result,
        resolvedAt: c.data.result.outcome === "verified" ? new Date().toISOString() : undefined,
      });
    }
  } else if (c.type === "data-execution" && c.data?.status === "done" && state.plan) {
    const lastExec = [...state.plan].reverse().find((s) => (s.chunk as { type: string }).type === "data-execution");
    if (lastExec && (lastExec.chunk as { data: { step: string } }).data.step === c.data.step) state.stage = "verifying";
  }
}

function handleEvents(id: string, init: RequestInit | undefined): Response {
  const state = proposals.get(id);
  if (!state) return errorJson(404, "proposal.not_found");
  const signal = init?.signal ?? undefined;
  return sseResponse(signal, async (emit, closed) => {
    const plan = state.plan;
    if (!plan) return;
    for (let i = 0; i < state.cursor; i++) emit(plan[i].chunk); // replay what a reconnecting client missed
    while (state.cursor < plan.length) {
      const step = plan[state.cursor];
      await sleep(step.delayMs, signal ?? undefined);
      if (closed()) return;
      state.cursor += 1;
      applyEmitted(state, step.chunk);
      emit(step.chunk);
    }
  });
}

function mockAudit(): AuditEntry[] {
  const now = Date.now();
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  return [
    { ts: at(2), actor: "agent-approved-by-user", action: "set_env", target: { kind: "app", name: "broken-shop" }, paramsHash: hex64("a1"), result: "ok", proposalId: "p_mock_0001", detail: m.auditDetail },
    { ts: at(40), actor: "user", action: "restart", target: { kind: "app", name: "broken-shop" }, paramsHash: hex64("a2"), result: "ok" },
    { ts: at(95), actor: "user", action: "domain.add", target: { kind: "domain", name: "shop.example.ir" }, paramsHash: hex64("a3"), result: "error", detail: m.auditDetail },
    { ts: at(180), actor: "agent-approved-by-user", action: "resize", target: { kind: "app", name: "blog-demo" }, paramsHash: hex64("a4"), result: "denied", proposalId: "p_mock_0000" },
    { ts: at(300), actor: "system", action: "session.connect", target: { kind: "account", name: "«redacted»" }, paramsHash: hex64("a5"), result: "ok" },
  ];
}

/**
 * The static sample incident, moved so that its whole timeline lies in the past (it ended `endedAgoMs` before
 * `now`, nothing after `now`). Without this a fixture dated later than the viewer's clock renders «۴۱ دقیقه بعد».
 */
export function relocateSampleIncident(inc: Incident, now: Date, endedAgoMs = 25 * 60_000): Incident {
  const anchor = Date.parse(inc.resolvedAt ?? inc.startedAt);
  const delta = now.getTime() - endedAgoMs - anchor;
  const shift = (stamp: string) => new Date(Math.min(now.getTime(), Date.parse(stamp) + delta)).toISOString();
  return {
    ...inc,
    startedAt: shift(inc.startedAt),
    ...(inc.resolvedAt ? { resolvedAt: shift(inc.resolvedAt) } : {}),
    finding: { ...inc.finding, facts: inc.finding.facts.map((o) => shiftObservation(o, shift)) },
    timeline: inc.timeline.map((e) => ({ ...e, ts: shift(e.ts) })),
  };
}

function mockIncidentList(): Incident[] {
  return [...incidents.values(), relocateSampleIncident(sampleIncident, new Date())];
}

/** Drop-in `fetch` for the copilot endpoints. Anything else is passed through to the real network. */
export async function mockFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, "http://localhost");
  const path = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();

  if (path === "/api/agent" && method === "POST") return handleAgent(init);

  const prop = /^\/api\/proposals\/([A-Za-z0-9_-]{1,64})(?:\/(approve|execute|reject|events))?$/.exec(path);
  if (prop) {
    const [, id, action] = prop;
    const state = proposals.get(id);
    if (!action && method === "GET") return state ? json(200, { proposal: currentProposal(state) }) : errorJson(404, "proposal.not_found");
    if (action === "approve" && method === "POST") return handleApprove(id, init);
    if (action === "execute" && method === "POST") return handleExecute(id, init);
    if (action === "events" && method === "GET") return handleEvents(id, init);
    if (action === "reject" && method === "POST") {
      if (!state) return errorJson(404, "proposal.not_found");
      if (state.stage !== "proposed") return errorJson(409, "proposal.invalid_state");
      state.stage = "rejected";
      return json(200, { proposal: currentProposal(state) });
    }
  }

  if (path === "/api/incidents" && method === "GET") return json(200, { incidents: mockIncidentList() });
  const inc = /^\/api\/incidents\/([A-Za-z0-9_-]{1,64})(\/markdown)?$/.exec(path);
  if (inc && method === "GET") {
    const found = mockIncidentList().find((i) => i.id === inc[1]);
    if (!found) return errorJson(404, "incident.not_found");
    if (inc[2]) {
      return new Response(found.summaryMarkdown ?? `# ${found.id}\n`, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } });
    }
    return json(200, { incident: found });
  }
  if (path === "/api/audit" && method === "GET") return json(200, { entries: mockAudit() });

  return fetch(input, init);
}
