// Temporary server-side holder for uploaded project archives referenced by a DeployPlan (`sourceRef`).
// Owned by the setup unit (U12). The actions unit (U11) imports `getSource` to deploy; signatures are stable.
// Never log or return the bytes. Entries expire and the store is bounded:
//  - in memory (a Liara disk may be absent; losing sources on restart only means "upload again"),
//  - at most MAX_PER_ACCOUNT sources per account (oldest evicted), MAX_TOTAL_BYTES overall (oldest evicted),
//  - one map shared through globalThis, because Next.js may bundle route handlers into separate module instances.
// Note: the bytes are the archive exactly as uploaded: a .zip (starts with "PK") or a .tar.gz (starts 1f 8b).
export interface StoredSource {
  ref: string;
  fileName: string;
  size: number;
  bytes: Uint8Array;
  createdAt: number;
}

export const SOURCE_TTL_MS = 45 * 60 * 1000;
export const MAX_PER_ACCOUNT = 3;
export const MAX_TOTAL_BYTES = 768 * 1024 * 1024;

type Entry = StoredSource & { accountId: string };
const KEY = Symbol.for("hamyar.setup.sources.v1");

function table(): Map<string, Entry> {
  const g = globalThis as unknown as Record<symbol, Map<string, Entry> | undefined>;
  return (g[KEY] ??= new Map());
}

function sweep(now: number): void {
  const t = table();
  for (const [k, v] of t) if (now - v.createdAt > SOURCE_TTL_MS) t.delete(k);
}

function totalBytes(): number {
  let n = 0;
  for (const v of table().values()) n += v.size;
  return n;
}

function randomRef(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[^\w.\- ؀-ۿ]/g, "_").slice(0, 120) || "project";
}

export async function putSource(accountId: string, bytes: Uint8Array, fileName: string): Promise<{ ref: string }> {
  if (bytes.byteLength > MAX_TOTAL_BYTES) throw new RangeError("source too large");
  const now = Date.now();
  sweep(now);
  const t = table();
  // Maps iterate in insertion order, so the first match is the oldest.
  const mine = [...t.entries()].filter(([, v]) => v.accountId === accountId);
  while (mine.length >= MAX_PER_ACCOUNT) t.delete(mine.shift()![0]);
  while (t.size > 0 && totalBytes() + bytes.byteLength > MAX_TOTAL_BYTES) t.delete(t.keys().next().value as string);
  const ref = randomRef();
  t.set(ref, { ref, fileName: safeName(fileName), size: bytes.byteLength, bytes, createdAt: now, accountId });
  return { ref };
}

export async function getSource(accountId: string, ref: string): Promise<StoredSource | null> {
  sweep(Date.now());
  const s = table().get(ref);
  if (!s || s.accountId !== accountId) return null;
  const { accountId: _owner, ...pub } = s;
  void _owner;
  return pub;
}

export async function deleteSource(accountId: string, ref: string): Promise<void> {
  const t = table();
  const s = t.get(ref);
  if (s && s.accountId === accountId) t.delete(ref);
}
