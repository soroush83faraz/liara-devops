"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getProposal, readProposalEvents } from "@/lib/copilot/api";
import { useCopilotStore } from "@/lib/copilot/store";
import { findProposal } from "@/lib/copilot/thread";
import { TERMINAL_PROPOSAL_STATUSES } from "@/lib/contracts";

export type FollowState = "idle" | "connected" | "reconnecting" | "lost";

const MAX_ATTEMPTS = 6;
const backoff = (n: number) => Math.min(8000, 1000 * 2 ** n);

/**
 * Follows a submitted proposal: attaches to `GET /api/proposals/[id]/events`, feeds execution / verification parts
 * into the thread, and re-reads the proposal when the stream ends so the card shows the server's real status.
 * Resume-safe: re-attaching after a drop replays idempotently (same part ids update in place).
 */
export function useProposalFollow(threadKey: string, proposalId: string, active: boolean): { state: FollowState; refresh: () => void } {
  const [state, setState] = useState<FollowState>("idle");
  const [nonce, setNonce] = useState(0);
  const apply = useCopilotStore((s) => s.applyProposalChunk);
  const lastNonce = useRef(nonce);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    const terminal = () => {
      const thread = useCopilotStore.getState().threads[threadKey];
      const p = thread ? findProposal(thread, proposalId) : undefined;
      return p ? TERMINAL_PROPOSAL_STATUSES.includes(p.status) : false;
    };

    const refreshProposal = async () => {
      try {
        const fresh = await getProposal(proposalId, undefined, signal);
        apply(threadKey, proposalId, { type: "data-proposal", id: proposalId, data: fresh });
      } catch {
        // keep the last known status; the user can press refresh
      }
    };

    void (async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
        setState(attempt === 0 ? "connected" : "reconnecting");
        try {
          await readProposalEvents(proposalId, (chunk) => apply(threadKey, proposalId, chunk), { signal });
        } catch {
          if (cancelled) return;
        }
        if (cancelled) return;
        await refreshProposal();
        if (terminal()) {
          setState("idle");
          return;
        }
        await new Promise((r) => setTimeout(r, backoff(attempt)));
      }
      if (!cancelled) setState("lost");
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active, threadKey, proposalId, apply, nonce]);

  const refresh = useCallback(() => {
    lastNonce.current += 1;
    setNonce(lastNonce.current);
  }, []);

  return { state, refresh };
}
