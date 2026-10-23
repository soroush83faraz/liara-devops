// Pure reducer for the execution progress view (unit-tested). Folds RunEvents into what the panel renders.
import { TERMINAL_PROPOSAL_STATUSES, type ProposalStatus, type StepStatus, type Verification } from "@/lib/contracts";
import type { RunEvent } from "./client";

export interface StepView {
  status: StepStatus;
  detail?: string;
}

export interface RunState {
  phase: "idle" | "approving" | "executing" | "finished";
  /** Keyed by plan step id (S1, S2, ...). */
  steps: Record<string, StepView>;
  /** Executor sub-steps that are not plan steps (read_envs, readback, ...), in arrival order. */
  other: Array<{ step: string } & StepView>;
  verification?: Verification;
  error?: { code: string; message: string };
  status?: ProposalStatus;
}

export const initialRun: RunState = { phase: "idle", steps: {}, other: [] };

const PLAN_STEP = /^S[1-9][0-9]?$/;
const TERMINAL = new Set<string>(TERMINAL_PROPOSAL_STATUSES);

export type RunAction = RunEvent | { kind: "reset" };

export function reduceRun(state: RunState, ev: RunAction): RunState {
  switch (ev.kind) {
    case "reset":
      return initialRun;
    case "phase":
      return { ...state, phase: ev.phase };
    case "step": {
      const view: StepView = { status: ev.status, detail: ev.detail };
      if (PLAN_STEP.test(ev.step)) return { ...state, steps: { ...state.steps, [ev.step]: view } };
      const rest = state.other.filter((o) => o.step !== ev.step);
      return { ...state, other: [...rest, { step: ev.step, ...view }].slice(-30) };
    }
    case "verification":
      return { ...state, verification: ev.result, phase: "finished" };
    case "error":
      return { ...state, error: { code: ev.code, message: ev.message }, phase: "finished" };
    case "status":
      return { ...state, status: ev.status, phase: TERMINAL.has(ev.status) ? "finished" : state.phase };
  }
}
