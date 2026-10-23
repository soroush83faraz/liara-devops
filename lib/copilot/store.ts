// Per-target copilot threads (zustand). Network loop lives here; the reducer lives in ./thread (pure).
// Chat content is kept in memory only: nothing is written to localStorage, the query cache or the URL.
import { create } from "zustand";
import { copilotFetch } from "./http";
import { classifyFailure, streamAgent, targetKey, toWireMessages, type AgentTarget, type FetchLike } from "./stream-client";
import {
  abortTurn,
  applyChunk,
  applyProposalEvent,
  emptyThread,
  failTurn,
  finishTurn,
  restartTurn,
  startTurn,
  type Thread,
} from "./thread";

interface CopilotStore {
  threads: Record<string, Thread>;
  /** A question queued by the command bar for a service whose copilot tab is about to open. */
  pending: Record<string, string>;
  send: (target: AgentTarget, text: string, opts?: { fetchImpl?: FetchLike; retryTurnId?: string }) => Promise<void>;
  retry: (target: AgentTarget, opts?: { fetchImpl?: FetchLike }) => Promise<void>;
  stop: (key: string) => void;
  reset: (key: string) => void;
  /** Account switch: aborts every running turn and forgets every thread and queued question. */
  resetAll: () => void;
  queueQuestion: (key: string, text: string) => void;
  takeQuestion: (key: string) => string | undefined;
  /** Event / refreshed data for a proposal (execution progress, verification, status). */
  applyProposalChunk: (key: string, proposalId: string, chunk: unknown) => void;
}

const controllers = new Map<string, AbortController>();

const MAX_QUESTION = 2_000;

export const useCopilotStore = create<CopilotStore>((set, get) => {
  const update = (key: string, fn: (t: Thread) => Thread) =>
    set((s) => ({ threads: { ...s.threads, [key]: fn(s.threads[key] ?? emptyThread()) } }));

  return {
    threads: {},
    pending: {},

    async send(target, text, opts = {}) {
      const key = targetKey(target);
      const question = text.trim().slice(0, MAX_QUESTION);
      const current = get().threads[key] ?? emptyThread();
      if (current.status === "streaming" || (question === "" && !opts.retryTurnId)) return;

      let turnId: string;
      let history: Thread;
      if (opts.retryTurnId) {
        turnId = opts.retryTurnId;
        update(key, (t) => restartTurn(t, turnId));
        const idx = current.turns.findIndex((t) => t.id === turnId);
        history = { ...current, turns: idx === -1 ? current.turns : current.turns.slice(0, idx) };
      } else {
        const started = startTurn(current, question);
        turnId = started.turnId;
        history = current;
        set((s) => ({ threads: { ...s.threads, [key]: started.thread } }));
      }
      const userText = opts.retryTurnId ? (current.turns.find((t) => t.id === turnId)?.userText ?? question) : question;

      controllers.get(key)?.abort();
      const controller = new AbortController();
      controllers.set(key, controller);
      try {
        const messages = toWireMessages(history, userText);
        for await (const chunk of streamAgent({ fetchImpl: opts.fetchImpl ?? copilotFetch, target, messages, signal: controller.signal })) {
          if (controller.signal.aborted) break;
          update(key, (t) => applyChunk(t, turnId, chunk));
        }
        if (!controller.signal.aborted) update(key, (t) => finishTurn(t, turnId));
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          update(key, (t) => abortTurn(t, turnId));
        } else {
          const f = classifyFailure(err);
          update(key, (t) => failTurn(t, turnId, { code: f.kind, status: f.status, retryAfterSec: f.retryAfterSec }));
        }
      } finally {
        if (controllers.get(key) === controller) controllers.delete(key);
      }
    },

    async retry(target, opts = {}) {
      const key = targetKey(target);
      const thread = get().threads[key];
      const last = thread?.turns[thread.turns.length - 1];
      if (!thread || !last || thread.status === "streaming") return;
      if (last.status !== "error" && last.status !== "aborted") return;
      await get().send(target, last.userText, { fetchImpl: opts.fetchImpl, retryTurnId: last.id });
    },

    stop(key) {
      const c = controllers.get(key);
      if (c) c.abort();
      update(key, (t) => {
        const last = t.turns[t.turns.length - 1];
        return last && last.status === "streaming" ? abortTurn(t, last.id) : t;
      });
    },

    resetAll() {
      for (const c of controllers.values()) c.abort();
      controllers.clear();
      set({ threads: {}, pending: {} });
    },

    reset(key) {
      controllers.get(key)?.abort();
      controllers.delete(key);
      set((s) => {
        const threads = { ...s.threads };
        delete threads[key];
        return { threads };
      });
    },

    queueQuestion(key, text) {
      const q = text.trim().slice(0, MAX_QUESTION);
      if (q) set((s) => ({ pending: { ...s.pending, [key]: q } }));
    },

    takeQuestion(key) {
      const q = get().pending[key];
      if (q === undefined) return undefined;
      set((s) => {
        const pending = { ...s.pending };
        delete pending[key];
        return { pending };
      });
      return q;
    },

    applyProposalChunk(key, proposalId, chunk) {
      update(key, (t) => applyProposalEvent(t, proposalId, chunk));
    },
  };
});

export { targetKey };
