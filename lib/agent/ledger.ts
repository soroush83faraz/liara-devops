// Run-scoped observation ledger: PASS-1 observations plus observations derived from tool reads.
// Ids are append-only (`O<n>`, never reused or renumbered) so earlier citations stay valid.
import { ObservationIdSchema, type Observation } from "@/lib/contracts/observation";

/** Hard cap on observations per run (a Finding holds at most 100 facts). */
export const MAX_LEDGER_OBSERVATIONS = 100;

const fingerprint = (o: Observation) => `${o.kind}|${o.summary}|${o.source}|${o.text}|${JSON.stringify(o.params)}`;
const idNum = (id: string) => Number(id.slice(1)) || 0;

export class ObservationLedger {
  private readonly items: Observation[] = [];
  private readonly seen = new Set<string>();
  private next = 1;

  constructor(initial: readonly Observation[] = []) {
    for (const o of initial) {
      this.items.push(o);
      this.seen.add(fingerprint(o));
      this.next = Math.max(this.next, idNum(o.id) + 1);
    }
  }

  get all(): readonly Observation[] {
    return this.items;
  }

  get(id: string): Observation | undefined {
    return this.items.find((o) => o.id === id);
  }

  /** Appends observations that are not already known, giving them fresh ids. Returns the appended ones. */
  append(found: readonly Observation[]): Observation[] {
    const added: Observation[] = [];
    for (const o of found) {
      if (this.items.length >= MAX_LEDGER_OBSERVATIONS) break;
      const fp = fingerprint(o);
      if (this.seen.has(fp)) continue;
      const id = `O${this.next}`;
      if (!ObservationIdSchema.safeParse(id).success) break;
      this.next++;
      this.seen.add(fp);
      const obs = { ...o, id };
      this.items.push(obs);
      added.push(obs);
    }
    return added;
  }

  /** Ids a model may cite: known and not flagged as possible prompt injection. */
  isCitable(id: string): boolean {
    const o = this.get(id);
    return Boolean(o && !o.flagged);
  }

  flaggedCount(): number {
    return this.items.filter((o) => o.flagged).length;
  }
}
