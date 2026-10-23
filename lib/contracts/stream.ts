import { z } from "zod";
import type { UIMessage, UIMessageChunk } from "ai";
import { CodeSchema, SafeIdSchema } from "./common";
import { FindingSchema } from "./hypothesis";
import { ObservationSchema } from "./observation";
import { IncidentSchema, ProposalSchema, VerificationSchema } from "./proposal";

/**
 * Copilot stream contract. Events use the AI SDK v7 UI-message chunk shape, so the
 * agent route (U10) writes them verbatim with `writer.write(event)` and the UI (U13)
 * reads them back as `message.parts` of type `data-<name>`. Re-sending a data part
 * with the same `id` updates it in place (use the step id for step progress).
 */

export const STEP_STATUSES = ["pending", "running", "done", "failed", "skipped"] as const;
export const StepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepDataSchema = z.strictObject({
  id: SafeIdSchema,
  label: z.string().min(1).max(200),
  status: StepStatusSchema,
  detail: z.string().max(500).optional(),
});
export type StepData = z.infer<typeof StepDataSchema>;

export const ExecutionDataSchema = z.strictObject({
  proposalId: SafeIdSchema,
  /** Execution step code, e.g. `read_envs`, `merge`, `send`, `readback`, or a plan step id `S2`. */
  step: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/),
  status: StepStatusSchema,
  detail: z.string().max(500).optional(),
});
export type ExecutionData = z.infer<typeof ExecutionDataSchema>;

export const VerificationDataSchema = z.strictObject({
  proposalId: SafeIdSchema,
  result: VerificationSchema,
});
export type VerificationData = z.infer<typeof VerificationDataSchema>;

export const ErrorDataSchema = z.strictObject({
  code: CodeSchema,
  messageFa: z.string().min(1).max(500),
  /** For 429-style errors: seconds until a retry makes sense. */
  retryAfterSec: z.number().int().min(0).max(3600).optional(),
});
export type ErrorData = z.infer<typeof ErrorDataSchema>;

/** Name -> schema of every copilot data part. Pass as `dataPartSchemas` to `useChat`/`Chat`. */
export const copilotDataPartSchemas = {
  step: StepDataSchema,
  observation: ObservationSchema,
  finding: FindingSchema,
  proposal: ProposalSchema,
  execution: ExecutionDataSchema,
  verification: VerificationDataSchema,
  incident: IncidentSchema,
  error: ErrorDataSchema,
} as const;

export type CopilotDataPartName = keyof typeof copilotDataPartSchemas;
export const COPILOT_DATA_PART_NAMES = Object.freeze(
  Object.keys(copilotDataPartSchemas) as CopilotDataPartName[],
);

/** AI SDK data-part mapping: part `data-<K>` carries `CopilotDataParts[K]`. */
export type CopilotDataParts = {
  [K in CopilotDataPartName]: z.infer<(typeof copilotDataPartSchemas)[K]>;
};
export type CopilotDataPartType = `data-${CopilotDataPartName}`;
export type CopilotUIMessage = UIMessage<unknown, CopilotDataParts>;
export type CopilotUIMessageChunk = UIMessageChunk<unknown, CopilotDataParts>;

export function copilotDataPartType<K extends CopilotDataPartName>(name: K): `data-${K}` {
  return `data-${name}`;
}

const PartIdSchema = z.string().min(1).max(128);
const optionalPartFields = { id: PartIdSchema.optional(), transient: z.boolean().optional() };

export const CopilotStreamEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("data-step"), data: StepDataSchema, ...optionalPartFields }),
  z.strictObject({ type: z.literal("data-observation"), data: ObservationSchema, ...optionalPartFields }),
  z.strictObject({ type: z.literal("data-finding"), data: FindingSchema, ...optionalPartFields }),
  z.strictObject({ type: z.literal("data-proposal"), data: ProposalSchema, ...optionalPartFields }),
  z.strictObject({ type: z.literal("data-execution"), data: ExecutionDataSchema, ...optionalPartFields }),
  z.strictObject({ type: z.literal("data-verification"), data: VerificationDataSchema, ...optionalPartFields }),
  z.strictObject({ type: z.literal("data-incident"), data: IncidentSchema, ...optionalPartFields }),
  z.strictObject({ type: z.literal("data-error"), data: ErrorDataSchema, ...optionalPartFields }),
  z.strictObject({ type: z.literal("text-delta"), id: PartIdSchema, delta: z.string().max(20_000) }),
]);
export type CopilotStreamEvent = z.infer<typeof CopilotStreamEventSchema>;
export type CopilotDataStreamEvent = Exclude<CopilotStreamEvent, { type: "text-delta" }>;
