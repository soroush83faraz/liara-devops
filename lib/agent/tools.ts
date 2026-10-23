// Model-facing tools. SECURITY: every tool is read-only and scoped to the already-resolved target (no tool
// takes an app/db name), outputs are redacted and wrapped as untrusted data, flagged lines are withheld
// (count only), and `propose_action` merely validates an intent: the real proposal is built by propose.ts.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { AI_PROPOSABLE_ACTION_TYPES, type ActionType } from "@/lib/contracts/action";
import { errorCode } from "@/lib/evidence/collect";
import { flagSuspiciousLines, wrapUntrusted } from "@/lib/security/injection";
import { assertAiMayPropose } from "@/lib/security/policy";
import type { Redactor } from "@/lib/security/redact";
import type { Observation } from "@/lib/evidence/types";
import { observationLine } from "./digest";
import type { ObservationLedger } from "./ledger";
import { LLM_BUDGET } from "./provider";
import { APP_READ_TOOLS, DB_READ_TOOLS, READS, type ReadEnv, type ReadResult, type ReadToolName } from "./tool-reads";

export interface ProposeIntent {
  draftId: string;
  type: ActionType;
  evidenceIds: string[];
}

export type ToolEventStatus = "running" | "done" | "failed" | "skipped";
export interface ToolEvent {
  tool: string;
  callIndex: number;
  status: ToolEventStatus;
  added: Observation[];
  flaggedWithheld?: number;
  error?: string;
}

export interface ToolRuntime {
  env: ReadEnv;
  ledger: ObservationLedger;
  redactor: Redactor;
  maxCalls: number;
  calls: number;
  intents: ProposeIntent[];
  onEvent?: (e: ToolEvent) => void;
}

const MAX_MODEL_LINES = 60;
const MAX_TOOL_OUTPUT_CHARS = 6_000;

const Minutes = z.number().int().min(5).max(60).describe("look-back window in minutes (5-60)");
const ReleaseId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().describe("release _id from list_releases; default: newest");

const INPUTS = {
  get_app_status: z.object({}),
  get_applets: z.object({}),
  list_releases: z.object({}),
  get_release: z.object({ releaseId: ReleaseId }),
  get_runtime_logs: z.object({ minutes: Minutes }),
  get_build_logs: z.object({ releaseId: ReleaseId }),
  get_events: z.object({ minutes: Minutes }),
  get_metrics: z.object({ minutes: Minutes }),
  probe_site: z.object({}),
  get_db_status: z.object({}),
  get_db_metrics: z.object({}),
} satisfies Record<ReadToolName, z.ZodType>;

const DESCRIPTIONS: Record<ReadToolName, string> = {
  get_app_status: "Read the investigated app's status, scale, plan and env KEY names (values are never returned).",
  get_applets: "Read the app's container (applet) states.",
  list_releases: "List the app's latest releases (id, tag, state).",
  get_release: "Read one release of this app (state, port, fail reason).",
  get_runtime_logs: "Read the app's runtime logs for a look-back window.",
  get_build_logs: "Read the build output of one release of this app.",
  get_events: "Read the app's platform events (restarts, OOM kills, env changes).",
  get_metrics: "Read the app's CPU/memory usage and recent series.",
  probe_site: "HTTP GET the app's own public URL once and report status and latency.",
  get_db_status: "Read the investigated database's status and scale (no credentials).",
  get_db_metrics: "Read the investigated database's resource usage.",
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const e = new Error("tool timeout");
      e.name = "TimeoutError";
      reject(e);
    }, ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Fact values outside the untrusted block may only be numbers, booleans, null or short id/enum-like tokens. */
const SAFE_FACT_TEXT = /^[A-Za-z0-9_.:@+-]{0,64}$/;

/** Splits facts into model-visible safe values and lines that must travel inside the untrusted block. */
function splitFacts(facts: ReadResult["facts"]): { safe: ReadResult["facts"]; lines: string[] } {
  const safe: ReadResult["facts"] = {};
  const lines: string[] = [];
  for (const [k, v] of Object.entries(facts)) {
    if (typeof v === "string" && !SAFE_FACT_TEXT.test(v)) lines.push(`fact ${k}=${v}`);
    else safe[k] = v;
  }
  return { safe, lines };
}

/** Redacts, drops instruction-like lines (count only) and wraps the rest as untrusted data. */
function modelView(name: string, rt: ToolRuntime, res: ReadResult, added: Observation[]) {
  const facts = splitFacts(res.facts);
  // Batch redaction: also catches a known secret split across two adjacent lines.
  const lines = rt.redactor.lines([...facts.lines, ...res.lines]).slice(-MAX_MODEL_LINES * 4);
  const flagged = new Set(flagSuspiciousLines(lines).map((f) => f.index));
  const safeLines = lines.filter((_, i) => !flagged.has(i)).slice(-MAX_MODEL_LINES);
  const usable = added.filter((o) => !o.flagged);
  const withheld = flagged.size + (added.length - usable.length);
  const body = [...usable.map(observationLine), ...(safeLines.length ? ["--- raw lines ---", ...safeLines] : [])].join("\n");
  return {
    ok: true,
    newObservationIds: usable.map((o) => o.id),
    facts: rt.redactor.deep(facts.safe),
    data: wrapUntrusted(name, body, { maxChars: MAX_TOOL_OUTPUT_CHARS }),
    flaggedWithheld: withheld,
  };
}

function readTool(name: ReadToolName, rt: ToolRuntime) {
  return tool({
    description: DESCRIPTIONS[name],
    inputSchema: INPUTS[name],
    execute: async (input: unknown) => {
      if (rt.env.signal?.aborted) throw new Error("aborted");
      if (rt.calls >= rt.maxCalls) {
        rt.onEvent?.({ tool: name, callIndex: rt.calls, status: "skipped", added: [] });
        return { ok: false, error: "tool_budget_exhausted" };
      }
      const callIndex = ++rt.calls;
      rt.onEvent?.({ tool: name, callIndex, status: "running", added: [] });
      try {
        const fn = READS[name] as (env: ReadEnv, input: unknown) => Promise<ReadResult>;
        const res = await withTimeout(fn(rt.env, input), LLM_BUDGET.toolLoop.toolTimeoutMs);
        const added = rt.ledger.append(res.observations);
        const view = modelView(name, rt, res, added);
        rt.onEvent?.({ tool: name, callIndex, status: "done", added, flaggedWithheld: view.flaggedWithheld });
        return view;
      } catch (e) {
        const code = errorCode(e);
        rt.onEvent?.({ tool: name, callIndex, status: "failed", added: [], error: code });
        return { ok: false, error: code };
      }
    },
  });
}

const ProposeInput = z.object({
  type: z.enum(AI_PROPOSABLE_ACTION_TYPES as unknown as [ActionType, ...ActionType[]]),
  evidenceIds: z.array(z.string().max(8)).min(1).max(10),
  rationale: z.string().max(500),
});

/** Validation-only: records a model intent. It never builds, stores or executes a proposal. */
function proposeTool(rt: ToolRuntime) {
  return tool({
    description: "Suggest (never execute) one corrective action. The server decides from evidence whether a proposal is shown; a person must approve it.",
    inputSchema: ProposeInput,
    execute: async (input: z.infer<typeof ProposeInput>) => {
      rt.onEvent?.({ tool: "propose_action", callIndex: rt.calls, status: "done", added: [] });
      try {
        assertAiMayPropose(input.type);
      } catch {
        return { accepted: false, reason: "action_not_allowed" };
      }
      const ids = [...new Set(input.evidenceIds)].filter((id) => rt.ledger.isCitable(id));
      if (ids.length === 0) return { accepted: false, reason: "no_valid_evidence" };
      if (rt.intents.length >= 1) return { accepted: false, reason: "one_intent_per_run" };
      const draftId = `D${rt.intents.length + 1}`;
      rt.intents.push({ draftId, type: input.type, evidenceIds: ids });
      return { accepted: true, draftId, note: "recorded; the server builds the actual proposal from evidence" };
    },
  });
}

export function buildTools(rt: ToolRuntime): ToolSet {
  const names = rt.env.target.kind === "app" ? APP_READ_TOOLS : DB_READ_TOOLS;
  const tools: ToolSet = {};
  for (const n of names) tools[n] = readTool(n, rt);
  tools.propose_action = proposeTool(rt);
  return tools;
}

export const ALL_TOOL_NAMES = [...APP_READ_TOOLS, ...DB_READ_TOOLS, "propose_action"] as const;
