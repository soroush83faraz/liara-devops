// Typed writer for copilot stream parts. Every data part is validated against the shared contract
// before it is written, so an inconsistent object can never reach the UI (it is dropped and counted).
import {
  ErrorDataSchema,
  StepDataSchema,
  type CopilotUIMessageChunk,
  type StepStatus,
} from "@/lib/contracts/stream";
import { FindingSchema, type Finding } from "@/lib/contracts/hypothesis";
import { ObservationSchema, type Observation } from "@/lib/contracts/observation";
import { IncidentSchema, ProposalSchema, type Incident, type Proposal } from "@/lib/contracts/proposal";

export interface Emitter {
  step(id: string, label: string, status: StepStatus, detail?: string): void;
  observation(o: Observation): void;
  finding(f: Finding): void;
  proposal(p: Proposal): void;
  incident(i: Incident): void;
  error(code: string, messageFa: string, retryAfterSec?: number): void;
  text(id: string, text: string): void;
  readonly dropped: number;
}

const TEXT_CHUNK = 400;

export function createEmitter(write: (chunk: CopilotUIMessageChunk) => void): Emitter {
  let dropped = 0;
  const data = <T>(schema: { safeParse(v: unknown): { success: boolean } }, type: string, id: string, value: T) => {
    if (!schema.safeParse(value).success) {
      dropped++;
      console.warn("[agent] dropped invalid part", { type });
      return;
    }
    write({ type, id, data: value } as unknown as CopilotUIMessageChunk);
  };
  return {
    step: (id, label, status, detail) => data(StepDataSchema, "data-step", id, { id, label, status, ...(detail ? { detail: detail.slice(0, 500) } : {}) }),
    observation: (o) => data(ObservationSchema, "data-observation", o.id, o),
    finding: (f) => data(FindingSchema, "data-finding", "finding", f),
    proposal: (p) => data(ProposalSchema, "data-proposal", p.id, p),
    incident: (i) => data(IncidentSchema, "data-incident", i.id, i),
    error: (code, messageFa, retryAfterSec) =>
      data(ErrorDataSchema, "data-error", `error-${code}`, { code, messageFa, ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) }),
    text: (id, text) => {
      write({ type: "text-start", id });
      for (let i = 0; i < text.length; i += TEXT_CHUNK) write({ type: "text-delta", id, delta: text.slice(i, i + TEXT_CHUNK) });
      write({ type: "text-end", id });
    },
    get dropped() {
      return dropped;
    },
  };
}
