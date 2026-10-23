// Port to the incidents module (owned by lib/actions). The agent only creates an incident record for a
// finished investigation; resolution, verification and export belong to lib/actions.
import { randomBytes } from "node:crypto";
import { storeIncidentSink } from "@/lib/actions/incidents";
import { getDefaultStore } from "@/lib/security/store";
import { IncidentSchema, type Incident, type IncidentTimelineEntry } from "@/lib/contracts/proposal";
import type { Finding } from "@/lib/contracts/hypothesis";
import type { Target } from "@/lib/contracts/common";

export interface IncidentInput {
  target: Target;
  finding: Finding;
  proposalId?: string;
  startedAt: string;
  timeline: IncidentTimelineEntry[];
}

export interface IncidentSink {
  create(accountId: string, input: IncidentInput): Promise<{ incidentId: string }>;
  /** True when records survive the process (false for the in-memory fallback). */
  readonly durable: boolean;
}

const newIncidentId = () => `inc_${randomBytes(12).toString("hex")}`;

/** Fallback used until lib/actions/incidents is available: keeps records in process memory only. */
export function createMemoryIncidentSink(max = 200): IncidentSink & { records: Map<string, Incident> } {
  const records = new Map<string, Incident>();
  return {
    durable: false,
    records,
    async create(accountId, input) {
      const incident = toIncident(newIncidentId(), accountId, input);
      records.set(incident.id, incident);
      while (records.size > max) records.delete(records.keys().next().value as string);
      return { incidentId: incident.id };
    },
  };
}

/** Builds the contract object streamed as `data-incident` (validated; throws when inconsistent). */
export function toIncident(id: string, accountId: string, input: IncidentInput): Incident {
  return IncidentSchema.parse({
    id,
    accountId,
    target: input.target,
    startedAt: input.startedAt,
    finding: input.finding,
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    timeline: input.timeline,
  });
}

const DEFAULT_SINK_KEY = Symbol.for("hamyar.agent.incidentSink.v1");

/** Default adapter: incidents are persisted through the actions module (same store as proposals and audit). */
export async function getDefaultIncidentSink(): Promise<IncidentSink> {
  const g = globalThis as unknown as Record<symbol, IncidentSink | undefined>;
  let sink = g[DEFAULT_SINK_KEY];
  if (!sink) {
    sink = storeIncidentSink(getDefaultStore());
    g[DEFAULT_SINK_KEY] = sink;
  }
  return sink;
}
