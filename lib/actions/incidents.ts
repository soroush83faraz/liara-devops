// Incidents: one record per investigated problem, linked to its proposal and verification. Stored in the
// store's `incidents` namespace; free text is redacted before it is persisted. The agent unit creates them.
import { randomBytes } from "node:crypto";
import type { Target } from "@/lib/contracts/common";
import { FindingSchema, type Finding } from "@/lib/contracts/hypothesis";
import {
  IncidentSchema,
  type Incident,
  type IncidentTimelineEntry,
  type Proposal,
  type Verification,
} from "@/lib/contracts/proposal";
import { redactString } from "@/lib/security/redact";
import type { Store } from "@/lib/security/store";
import { safeLog } from "./log";

export { renderIncidentMarkdown } from "./incident-markdown";

type IncidentStore = Pick<Store, "incidents">;
type TimelineKind = IncidentTimelineEntry["kind"];

const MAX_TIMELINE = 200;
const iso = (ms: number) => new Date(ms).toISOString();
export const newIncidentId = () => `inc_${randomBytes(12).toString("base64url")}`;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const red = (s: string, max: number) => clip(redactString(s), max);

/** Redacts every free-text field (defense in depth: the evidence engine already redacted excerpts). */
export function sanitizeFinding(f: Finding): Finding {
  return FindingSchema.parse({
    ...f,
    facts: f.facts.map((o) => ({
      ...o,
      text: red(o.text, 4000),
      params: Object.fromEntries(Object.entries(o.params).map(([k, v]) => [k, typeof v === "string" ? red(v, 500) : v])),
    })),
    hypotheses: f.hypotheses.map((h) => ({ ...h, titleFa: red(h.titleFa, 200), explanationFa: red(h.explanationFa, 2000) })),
    ruledOut: f.ruledOut.map((r) => ({ ...r, titleFa: red(r.titleFa, 200), reasonFa: red(r.reasonFa, 1000) })),
    unknowns: f.unknowns.map((u) => ({ ...u, descriptionFa: red(u.descriptionFa, 500), ...(u.howToGet ? { howToGet: red(u.howToGet, 500) } : {}) })),
    ...(f.limitsNote ? { limitsNote: f.limitsNote.map((n) => red(n, 500)) } : {}),
  });
}

const entry = (kind: TimelineKind, ts: string, refId?: string, textFa?: string): IncidentTimelineEntry => ({
  ts,
  kind,
  ...(refId ? { refId } : {}),
  ...(textFa ? { textFa: red(textFa, 500) } : {}),
});

export interface CreateIncidentInput {
  target: Target;
  finding: Finding;
  /** ISO; defaults to now. */
  startedAt?: string;
  proposalId?: string;
  /** Optional caller timeline (e.g. the agent's); free text is redacted. */
  timeline?: IncidentTimelineEntry[];
  noteFa?: string;
}

export async function createIncident(store: IncidentStore, accountId: string, input: CreateIncidentInput, now: number = Date.now()): Promise<Incident> {
  const startedAt = input.startedAt ?? iso(now);
  const timeline: IncidentTimelineEntry[] = input.timeline?.length
    ? input.timeline.map((t) => entry(t.kind, t.ts, t.refId, t.textFa))
    : [entry("detected", startedAt, undefined, input.noteFa), entry("investigated", iso(now))];
  if (input.proposalId && !timeline.some((t) => t.kind === "proposed" && t.refId === input.proposalId)) {
    timeline.push(entry("proposed", iso(now), input.proposalId));
  }
  const incident = IncidentSchema.parse({
    id: newIncidentId(),
    accountId,
    target: input.target,
    startedAt,
    finding: sanitizeFinding(input.finding),
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    timeline: timeline.slice(-MAX_TIMELINE),
  });
  await store.incidents.put(accountId, incident.id, incident);
  return incident;
}

/**
 * Store-backed sink matching lib/agent/incident-port's IncidentSink shape, so the agent can switch from its
 * in-memory fallback: `create(accountId, input) -> {incidentId}`.
 */
export function storeIncidentSink(store: IncidentStore) {
  return {
    durable: true as const,
    async create(accountId: string, input: CreateIncidentInput): Promise<{ incidentId: string }> {
      return { incidentId: (await createIncident(store, accountId, input)).id };
    },
  };
}

async function mutate(store: IncidentStore, accountId: string, id: string, fn: (i: Incident) => Incident): Promise<Incident | undefined> {
  return store.incidents.update(accountId, id, (current) => (current ? IncidentSchema.parse(fn(current)) : undefined));
}

const push = (i: Incident, e: IncidentTimelineEntry): IncidentTimelineEntry[] => [...i.timeline, e].slice(-MAX_TIMELINE);

export function attachProposal(store: IncidentStore, accountId: string, incidentId: string, proposal: Pick<Proposal, "id">, now: number = Date.now()): Promise<Incident | undefined> {
  return mutate(store, accountId, incidentId, (i) => ({ ...i, proposalId: proposal.id, timeline: push(i, entry("proposed", iso(now), proposal.id)) }));
}

export function recordIncidentEvent(
  store: IncidentStore,
  accountId: string,
  incidentId: string,
  kind: TimelineKind,
  opts: { refId?: string; textFa?: string; now?: number } = {},
): Promise<Incident | undefined> {
  return mutate(store, accountId, incidentId, (i) => ({ ...i, timeline: push(i, entry(kind, iso(opts.now ?? Date.now()), opts.refId, opts.textFa)) }));
}

export function attachVerification(
  store: IncidentStore,
  accountId: string,
  incidentId: string,
  verification: Verification,
  opts: { proposalId?: string; now?: number } = {},
): Promise<Incident | undefined> {
  const at = iso(opts.now ?? Date.now());
  return mutate(store, accountId, incidentId, (i) => ({ ...i, verification, timeline: push(i, entry(verification.outcome, at, opts.proposalId)) }));
}

export function resolveIncident(store: IncidentStore, accountId: string, incidentId: string, opts: { noteFa?: string; now?: number } = {}): Promise<Incident | undefined> {
  const now = opts.now ?? Date.now();
  return mutate(store, accountId, incidentId, (i) => {
    if (i.resolvedAt) return i;
    const resolvedAt = iso(Math.max(now, Date.parse(i.startedAt)));
    return { ...i, resolvedAt, timeline: push(i, entry("resolved", resolvedAt, undefined, opts.noteFa)) };
  });
}

export function getIncident(store: IncidentStore, accountId: string, id: string): Promise<Incident | undefined> {
  return store.incidents.get(accountId, id);
}

export function listIncidents(store: IncidentStore, accountId: string, limit = 50): Promise<Incident[]> {
  return store.incidents.list(accountId, { limit });
}

/** The incident a proposal belongs to (newest first), if any. Never throws. */
export async function findIncidentByProposal(store: IncidentStore, accountId: string, proposalId: string): Promise<Incident | undefined> {
  try {
    return (await store.incidents.list(accountId)).find((i) => i.proposalId === proposalId);
  } catch (e) {
    safeLog("incident_update_failed", e);
    return undefined;
  }
}
