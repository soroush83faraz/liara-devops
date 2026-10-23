// Resolves user-facing names (DB hostname, network name, domain name) to the ids Liara paths need.
// Always reads fresh (no cache), so a resource created a moment ago by another step is found.
import {
  DomainsResponseSchema,
  databaseRef,
  isLiaraError,
  listApps,
  listDatabases,
  listDomains,
  listNetworks,
  type DatabaseSummary,
  type Domain,
  type LiaraClient,
  type NetworkRef,
} from "@/lib/liara";
import { ActionError } from "./errors";

export const isNotFound = (e: unknown): boolean => isLiaraError(e) && e.kind === "not_found";

export interface ResolvedDatabase {
  summary: DatabaseSummary;
  /** Id for `/v1/databases/{id}` paths (`_id`, then `id`, then `DBId`). */
  ref: string;
}

/** The database whose hostname is exactly `name`, or undefined. Two matches is an error (fail closed). */
export async function findDatabase(liara: LiaraClient, name: string): Promise<ResolvedDatabase | undefined> {
  const matches = (await listDatabases(liara)).filter((d) => d.hostname === name);
  if (matches.length > 1) throw new ActionError("conflict", { details: { reason: "duplicate_db_hostname", db: name } });
  const summary = matches[0];
  if (!summary) return undefined;
  const ref = databaseRef(summary);
  if (!ref) throw new ActionError("liara_bad_response", { details: { reason: "db_without_id", db: name } });
  return { summary, ref };
}

export async function resolveDatabase(liara: LiaraClient, name: string): Promise<ResolvedDatabase> {
  const db = await findDatabase(liara, name);
  if (!db) throw new ActionError("not_found", { details: { resource: "db", name } });
  return db;
}

/** Network `_id` for a network NAME (the contracts carry names; Liara create calls take ids). */
export async function resolveNetworkId(liara: LiaraClient, name: string): Promise<string> {
  const matches = (await listNetworks(liara)).filter((n) => n.name === name);
  if (matches.length > 1) throw new ActionError("ambiguous_network", { details: { network: name, count: matches.length } });
  const id = matches[0]?._id;
  if (!id) throw new ActionError("not_found", { details: { resource: "network", name } });
  return id;
}

/** True only when both sides name the same private network (by `_id`, else by name). Unknown = false. */
export function sameNetwork(a: NetworkRef | null | undefined, b: NetworkRef | null | undefined): boolean {
  if (!a || !b) return false;
  if (a._id && b._id) return a._id === b._id;
  return Boolean(a.name) && a.name === b.name;
}

const MAX_APPS_SCANNED = 30;

const domainMatches = (d: Domain, name: string) => d.name === name || d.punycodeName === name;

/**
 * Finds a domain by name. [VAL] `GET /v1/domains` without `project` is assumed to list every domain; if
 * Liara refuses it, falls back to scanning the domains of (at most 30) apps.
 */
export async function findDomain(liara: LiaraClient, name: string): Promise<Domain | undefined> {
  try {
    const all = (await liara.get("/v1/domains", DomainsResponseSchema)).domains;
    return all.find((d) => domainMatches(d, name));
  } catch (e) {
    if (!isLiaraError(e) || (e.kind !== "validation" && e.kind !== "not_found")) throw e;
  }
  const apps = (await listApps(liara)).slice(0, MAX_APPS_SCANNED);
  for (const app of apps) {
    if (!app.project_id) continue;
    const hit = (await listDomains(liara, app.project_id)).find((d) => domainMatches(d, name));
    if (hit) return hit;
  }
  return undefined;
}
