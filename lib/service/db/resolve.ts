// Path param (hostname or Liara ref) -> database. The UI only knows hostnames; Liara's action endpoints want the ref (`_id`).
import { databaseRef, listDatabases, type DatabaseSummary, type LiaraClient } from "../../liara";
import { globalCache } from "../../canvas/ttl-cache";

export interface ResolvedDb {
  summary: DatabaseSummary;
  /** Id for `/v1/databases/{ref}` paths. */
  ref: string;
  hostname: string;
}

/** Hostname or ref: DNS-ish names and Mongo-style ids; no slashes, dots-only or control characters. */
export const DB_PARAM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function findDatabase(list: readonly DatabaseSummary[], param: string): ResolvedDb | undefined {
  const lower = param.toLowerCase();
  const hit =
    list.find((d) => d.hostname === param) ??
    list.find((d) => d.hostname?.toLowerCase() === lower) ??
    list.find((d) => databaseRef(d) === param || d._id === param || d.id === param || d.DBId === param);
  if (!hit) return undefined;
  const ref = databaseRef(hit);
  const hostname = hit.hostname ?? ref;
  return ref && hostname ? { summary: hit, ref, hostname } : undefined;
}

const LIST_TTL_MS = 8_000;

/** Lists databases (cached briefly per account so the 5 tabs polling together cost one Liara call) and resolves `param`. */
export async function resolveDatabase(liara: LiaraClient, accountKey: string, param: string): Promise<ResolvedDb | undefined> {
  const list = await globalCache<DatabaseSummary[]>("db-panel-list", LIST_TTL_MS).get(accountKey, () => listDatabases(liara));
  return findDatabase(list, param);
}
