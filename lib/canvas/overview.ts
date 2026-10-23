// Pure normalisation of Liara list/detail responses into the canvas Overview. No I/O, no secrets in the output.
import { normalizeStatus, type ServiceStatus } from "@/components/ui/status";
import type { AppDetail, AppSummary, DatabaseDetail, DatabaseSummary, Network, NetworkRef } from "@/lib/liara/schemas";
import { appServiceId, dbServiceId } from "./service-id";
import type { Overview, OverviewEdge, OverviewNetwork, OverviewService } from "./types";
import { defaultAppUrl } from "./urls";

/** Apps whose env vars are inspected for edges; the rest are listed but flagged `edgesPartial`. */
export const MAX_ENV_APPS = 30;
export const MAX_DB_DETAILS = 30;

export interface OverviewInput {
  apps: AppSummary[];
  /** Detail by app name; `null` = fetch failed, missing = not fetched (beyond the cap). */
  appDetails: ReadonlyMap<string, AppDetail | null>;
  databases: DatabaseSummary[];
  /** Detail by database ref; same null/missing semantics. */
  dbDetails: ReadonlyMap<string, DatabaseDetail | null>;
  networks: Network[] | null;
  balance?: number;
  balanceSource?: "team" | "user";
  balanceUnreadable?: boolean;
  errors?: Overview["errors"];
  now?: Date;
}

/** Status of an app: stopped when scaled to zero, otherwise whatever Liara reports (unknown stays unknown). */
export function appStatus(app: Pick<AppSummary, "status" | "scale">): ServiceStatus {
  if (app.scale === 0) return "stopped";
  return normalizeStatus(app.status);
}

export function dbStatus(db: Pick<DatabaseSummary, "status" | "scale">): ServiceStatus {
  if (db.scale === 0) return "stopped";
  return normalizeStatus(db.status);
}

export const appName = (a: Pick<AppSummary, "project_id" | "_id">): string | undefined => a.project_id || a._id || undefined;

export function dbRef(db: Pick<DatabaseSummary, "_id" | "id" | "DBId">): string | undefined {
  return db._id || db.id || db.DBId || undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does `value` mention the private hostname as a whole token?
 * "mydb" matches `postgres://u@mydb:5432/x` and `mydb`, but not `mydb2`, `my-mydb`, or `mydb.example.com`.
 * `withPort` is true when `host:internalPort` appears, which is a stronger signal.
 */
export function matchesHost(value: string, hostname: string, internalPort?: number): { match: boolean; withPort: boolean } {
  if (hostname.length < 3 || !value) return { match: false, withPort: false };
  const host = escapeRe(hostname);
  const re = new RegExp(`(?<![A-Za-z0-9_.-])${host}(?![A-Za-z0-9_-])(?!\\.[A-Za-z0-9])`, "i");
  if (!re.test(value)) return { match: false, withPort: false };
  const withPort =
    internalPort !== undefined && new RegExp(`(?<![A-Za-z0-9_.-])${host}:${internalPort}(?![0-9])`, "i").test(value);
  return { match: true, withPort };
}

export interface EdgeApp {
  id: string;
  networkId: string | null;
  envs: ReadonlyArray<{ key: string; value: string }>;
}
export interface EdgeDb {
  id: string;
  networkId: string | null;
  hostname?: string;
  internalPort?: number;
}

/**
 * Derived, never guessed: an edge exists only when an env VALUE of an app contains the private hostname of a
 * database in the SAME (non-null) network. One edge per (app, db); `viaKey` is the KEY name only.
 */
export function deriveEdges(apps: readonly EdgeApp[], dbs: readonly EdgeDb[]): OverviewEdge[] {
  const edges: OverviewEdge[] = [];
  for (const app of apps) {
    if (!app.networkId) continue;
    for (const db of dbs) {
      if (!db.hostname || db.networkId !== app.networkId) continue;
      let best: { key: string; withPort: boolean } | undefined;
      for (const env of app.envs) {
        if (!env.key) continue;
        const m = matchesHost(env.value, db.hostname, db.internalPort);
        if (!m.match) continue;
        if (!best || (m.withPort && !best.withPort)) best = { key: env.key, withPort: m.withPort };
        if (best.withPort) break;
      }
      if (best) edges.push({ from: app.id, to: db.id, viaKey: best.key });
    }
  }
  return edges;
}

function mergeNetworks(listed: Network[] | null, refs: Array<NetworkRef | null | undefined>): OverviewNetwork[] {
  const byId = new Map<string, OverviewNetwork>();
  for (const n of listed ?? []) if (n._id) byId.set(n._id, { id: n._id, name: n.name ?? n._id });
  for (const r of refs) if (r?._id && !byId.has(r._id)) byId.set(r._id, { id: r._id, name: r.name ?? r._id });
  return [...byId.values()];
}

export function buildOverview(input: OverviewInput): Overview {
  const { apps, appDetails, databases, dbDetails } = input;
  const services: OverviewService[] = [];
  let edgesPartial = false;
  const edgeApps: EdgeApp[] = [];
  const edgeDbs: EdgeDb[] = [];
  const refs: Array<NetworkRef | null | undefined> = [];

  for (const app of apps) {
    const name = appName(app);
    if (!name) continue;
    const id = appServiceId(name);
    const detail = appDetails.get(name);
    if (detail === undefined || detail === null) edgesPartial = true;
    const net = app.network ?? detail?.network;
    refs.push(net);
    const networkId = net?._id ?? null;
    const url = detail?.defaultSubdomain === false ? undefined : defaultAppUrl(name);
    services.push({
      id,
      kind: "app",
      name,
      networkId,
      platformOrEngine: app.type ?? "unknown",
      status: appStatus(app),
      rawStatus: app.status,
      planId: app.planID,
      hourlyPriceToman: detail?.hourlyPrice,
      createdAt: app.created_at,
      url,
      healthUrl: url,
    });
    if (detail) {
      edgeApps.push({
        id,
        networkId,
        envs: detail.envs.filter((e) => e.key).map((e) => ({ key: e.key, value: e.value })),
      });
    }
  }

  for (const db of databases) {
    const ref = dbRef(db);
    const hostname = db.hostname || ref;
    if (!hostname) continue;
    const id = dbServiceId(hostname);
    const detail = ref ? dbDetails.get(ref) : undefined;
    if (detail === undefined || detail === null) edgesPartial = true;
    const net = detail?.network;
    refs.push(net);
    const networkId = net?._id ?? null;
    services.push({
      id,
      kind: "db",
      name: hostname,
      ref,
      networkId,
      platformOrEngine: db.type ?? detail?.type ?? "unknown",
      status: dbStatus(db),
      rawStatus: db.status,
      planId: db.planID,
      hourlyPriceToman: detail?.hourlyPrice,
      createdAt: db.created_at,
    });
    edgeDbs.push({ id, networkId, hostname: db.hostname, internalPort: db.internalPort ?? detail?.internalPort });
  }

  const overview: Overview = {
    networks: mergeNetworks(input.networks, refs),
    services,
    edges: deriveEdges(edgeApps, edgeDbs),
    errors: input.errors ?? {},
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
  if (edgesPartial) overview.edgesPartial = true;
  if (input.balance !== undefined) overview.balance = input.balance;
  if (input.balanceSource) overview.balanceSource = input.balanceSource;
  if (input.balanceUnreadable) overview.balanceUnreadable = true;
  return overview;
}
