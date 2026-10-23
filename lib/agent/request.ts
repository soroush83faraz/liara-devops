// Request body validation for POST /api/agent (AI SDK useChat shape: { messages: UIMessage[], target? }).
// Only text parts are read; data/tool parts of earlier assistant messages are ignored, client "system"
// messages are never used.
import { z } from "zod";
import { AppNameSchema, DbNameSchema } from "@/lib/contracts/common";
import type { TargetHint } from "./target";

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_MESSAGES = 20;
export const MAX_TEXT_PART = 4_000;

const TextPartSchema = z.object({ type: z.literal("text"), text: z.string().max(MAX_TEXT_PART) });
const PartSchema = z.object({ type: z.string().max(64) }).passthrough();
const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(PartSchema).max(300),
});
const TargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app"), name: AppNameSchema }),
  z.object({ kind: z.literal("db"), name: DbNameSchema }),
]);
export const AgentBodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(MAX_MESSAGES),
  target: TargetSchema.optional(),
});

export interface ParsedAgentRequest {
  text: string;
  history: string[];
  target?: TargetHint;
}

function textOf(parts: readonly z.infer<typeof PartSchema>[]): string | null {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type !== "text") continue;
    const t = TextPartSchema.safeParse(p);
    if (!t.success) return null;
    out.push(t.data.text);
  }
  return out.join("\n").slice(0, MAX_TEXT_PART);
}

export function parseAgentBody(raw: unknown): ParsedAgentRequest | null {
  const body = AgentBodySchema.safeParse(raw);
  if (!body.success) return null;
  const msgs = body.data.messages.filter((m) => m.role !== "system");
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "user") return null;
  const text = textOf(last.parts);
  if (text === null || !text.trim()) return null;
  const history: string[] = [];
  for (const m of msgs.slice(0, -1)) {
    const t = textOf(m.parts);
    if (t === null) return null;
    if (t.trim()) history.push(`${m.role}: ${t.slice(0, 600)}`);
  }
  return { text, history, ...(body.data.target ? { target: body.data.target } : {}) };
}
