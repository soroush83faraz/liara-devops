// Turns a Turn's flat card list into the blocks the thread renders. Pure.
//  - all steps + observations collapse into ONE timeline (observations are its expandable raw data);
//  - execution + verification cards attach to their proposal even when they arrive before it or in another turn;
//  - nothing is silently dropped: orphan execution/verification cards still render.
import type { ExecutionData, Proposal, VerificationData } from "@/lib/contracts";
import type { Card, CardOf, Thread, Turn } from "./thread";

export type Block =
  | { kind: "text"; key: string; card: CardOf<"text"> }
  | { kind: "timeline"; key: string; steps: CardOf<"step">[]; observations: CardOf<"observation">[] }
  | { kind: "finding"; key: string; card: CardOf<"finding"> }
  | { kind: "proposal"; key: string; proposal: Proposal; executions: ExecutionData[]; verification?: VerificationData }
  | { kind: "orphan"; key: string; proposalId: string; executions: ExecutionData[]; verification?: VerificationData }
  | { kind: "incident"; key: string; card: CardOf<"incident"> }
  | { kind: "error"; key: string; card: CardOf<"error"> };

/** One entry per step code, in first-seen order, latest data wins (terminal states are never reverted by the reducer). */
export function dedupeExecutions(list: ExecutionData[]): ExecutionData[] {
  const order: string[] = [];
  const latest = new Map<string, ExecutionData>();
  for (const e of list) {
    if (!latest.has(e.step)) order.push(e.step);
    latest.set(e.step, e);
  }
  return order.map((s) => latest.get(s)!);
}

function collect(turns: readonly Turn[], proposalId: string) {
  const executions: ExecutionData[] = [];
  let verification: VerificationData | undefined;
  for (const t of turns) {
    for (const c of t.cards) {
      if (c.kind === "execution" && c.data.proposalId === proposalId) executions.push(c.data);
      if (c.kind === "verification" && c.data.proposalId === proposalId) verification = c.data;
    }
  }
  return { executions: dedupeExecutions(executions), verification };
}

export function groupTurn(turn: Turn, thread: Pick<Thread, "turns">): Block[] {
  const blocks: Block[] = [];
  const steps = turn.cards.filter((c): c is CardOf<"step"> => c.kind === "step");
  const observations = turn.cards.filter((c): c is CardOf<"observation"> => c.kind === "observation");
  const knownProposals = new Set<string>();
  for (const t of thread.turns) for (const c of t.cards) if (c.kind === "proposal") knownProposals.add(c.data.id);

  let timelineAdded = false;
  const orphanSeen = new Set<string>();
  for (const card of turn.cards as Card[]) {
    switch (card.kind) {
      case "text":
        if (card.text.trim() !== "") blocks.push({ kind: "text", key: card.key, card });
        break;
      case "step":
      case "observation":
        if (!timelineAdded) {
          timelineAdded = true;
          blocks.push({ kind: "timeline", key: "timeline", steps, observations });
        }
        break;
      case "finding":
        blocks.push({ kind: "finding", key: card.key, card });
        break;
      case "proposal": {
        const { executions, verification } = collect(thread.turns, card.data.id);
        blocks.push({ kind: "proposal", key: card.key, proposal: card.data, executions, verification });
        break;
      }
      case "execution":
      case "verification": {
        const id = card.data.proposalId;
        if (!knownProposals.has(id) && !orphanSeen.has(id)) {
          orphanSeen.add(id);
          const { executions, verification } = collect([turn], id);
          blocks.push({ kind: "orphan", key: `orphan:${id}`, proposalId: id, executions, verification });
        }
        break;
      }
      case "incident":
        blocks.push({ kind: "incident", key: card.key, card });
        break;
      case "error":
        blocks.push({ kind: "error", key: card.key, card });
        break;
    }
  }
  return blocks;
}

/** True when the investigation had a step that failed or was skipped: findings must say the evidence is incomplete. */
export function hasIncompleteEvidence(turn: Turn): boolean {
  return turn.cards.some((c) => c.kind === "step" && c.data.status === "failed");
}
