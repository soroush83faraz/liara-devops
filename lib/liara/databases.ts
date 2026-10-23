import { z } from "zod";
import { invalidArgument, type LiaraClient } from "./core";
import {
  AnyBodySchema,
  BackupLinkSchema,
  BackupsResponseSchema,
  CreatedDatabaseSchema,
  DatabaseCredentialsRawSchema,
  DatabaseDetailResponseSchema,
  DatabasesResponseSchema,
  MetricSeriesSchema,
  MetricsSummarySchema,
  type Backup,
  type DatabaseDetail,
  type DatabaseSummary,
  type MetricSeries,
  type MetricsSummary,
} from "./schemas";
import { parseRuntimeLogs, type LogLine } from "./logs";
import type { MetricName } from "./metrics";
import { isRecord, seg } from "./util";

export const DB_ENGINES = ["mysql", "mariadb", "postgres", "mssql", "mongodb", "redis", "elasticsearch", "rabbitmq", "clickhouse"] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

const d = (id: string) => `/v1/databases/${seg(id)}`;

/** Id to use in `/v1/databases/{id}` paths: the CLI uses `_id` from the list [CLI]; `id` / `DBId` are fallbacks [VAL]. */
export function databaseRef(db: Pick<DatabaseSummary, "_id" | "id" | "DBId">): string | undefined {
  return db._id ?? db.id ?? db.DBId;
}

/** [V] GET /v1/databases (no credentials in the list). */
export async function listDatabases(client: LiaraClient): Promise<DatabaseSummary[]> {
  return (await client.get("/v1/databases", DatabasesResponseSchema)).databases;
}

/** [V] GET /v1/databases/{id}. The parsed type has NO password: it is stripped at parse time. Use `getDatabaseCredentials` to opt in. */
export async function getDatabase(client: LiaraClient, id: string): Promise<DatabaseDetail> {
  return (await client.get(d(id), DatabaseDetailResponseSchema)).database;
}

export interface DatabaseCredentials {
  hostname?: string;
  username?: string;
  /** Clear-text `root_password` returned by the API. Never log, persist, or send to an LLM. */
  password?: string;
  dbName?: string;
  port?: number;
  internalPort?: number;
  publicNetwork?: boolean;
  publicHost?: string;
}

/** Explicit opt-in to the secret part of `GET /v1/databases/{id}`. */
export async function getDatabaseCredentials(client: LiaraClient, id: string): Promise<DatabaseCredentials> {
  const { database: db } = await client.get(d(id), DatabaseCredentialsRawSchema);
  return {
    hostname: db.hostname,
    username: db.username,
    password: db.root_password,
    dbName: db.dbName,
    port: db.port,
    internalPort: db.internalPort,
    publicNetwork: db.publicNetwork,
    publicHost: db.node?.host,
  };
}

const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key/i;

/** Deep copy without any password/secret-looking property (use before logging or handing raw DB objects around). */
export function redactDatabase<T>(db: T): T {
  if (Array.isArray(db)) return db.map(redactDatabase) as T;
  if (!isRecord(db)) return db;
  return Object.fromEntries(Object.entries(db).filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => [k, redactDatabase(v)])) as T;
}

export interface CreateDatabaseInput {
  hostname: string;
  type: DbEngine;
  version: string;
  planID: string;
  bundlePlanID: string;
  publicNetwork: boolean;
  /** Network `_id`. Immutable after creation. */
  network?: string;
  options?: { standaloneReplicaSet?: boolean };
}

/** [V+CLI] POST /v1/databases -> {databaseID}. BILLED. 409 duplicate; 403 free_plan_platform / free_plan_count. */
export async function createDatabase(client: LiaraClient, input: CreateDatabaseInput): Promise<string | undefined> {
  if (!DB_ENGINES.includes(input.type)) throw invalidArgument(`Unknown database engine: ${input.type}`);
  if (input.planID === "free" && input.bundlePlanID !== "free") throw invalidArgument('Only the "free" bundle plan is available for the free plan');
  return (await client.post("/v1/databases", CreatedDatabaseSchema, { json: input })).databaseID;
}

/** [V] DELETE /v1/databases/{id}. Permanent. */
export async function deleteDatabase(client: LiaraClient, id: string): Promise<void> {
  await client.delete(d(id), AnyBodySchema);
}

/** [V] POST /v1/databases/{id}/actions/scale {scale: 0|1} */
export async function scaleDatabase(client: LiaraClient, id: string, scale: 0 | 1): Promise<void> {
  await client.post(`${d(id)}/actions/scale`, AnyBodySchema, { json: { scale } });
}

/** [V] POST /v1/databases/{id}/resize {planID, disk}. `disk` semantics unverified [VAL] (CLI passes a flag). */
export async function resizeDatabase(client: LiaraClient, id: string, planID: string, disk?: boolean): Promise<void> {
  await client.post(`${d(id)}/resize`, AnyBodySchema, { json: { planID, disk } });
}

/** [V] PATCH /v1/databases/{id}/settings {type, options:{maxConnections,...}}. Option names differ per engine. */
export async function updateDatabaseSettings(client: LiaraClient, id: string, type: DbEngine, options: Record<string, number | string>): Promise<void> {
  await client.patch(`${d(id)}/settings`, AnyBodySchema, { json: { type, options } });
}

/** [V] PATCH /v1/databases/{id}/public-network/{enable|disable} */
export async function setDatabasePublicNetwork(client: LiaraClient, id: string, enabled: boolean): Promise<void> {
  await client.patch(`${d(id)}/public-network/${enabled ? "enable" : "disable"}`, AnyBodySchema);
}

/** [V] POST /v1/databases/{id}/control-panel/{enable|disable} -> {controlPanelID} */
export async function setDatabaseControlPanel(client: LiaraClient, id: string, enabled: boolean): Promise<string | undefined> {
  const res = await client.post(`${d(id)}/control-panel/${enabled ? "enable" : "disable"}`, z.unknown());
  return isRecord(res) && typeof res.controlPanelID === "string" ? res.controlPanelID : undefined;
}

/** [V] GET /v1/databases/{id}/backups */
export async function listDatabaseBackups(client: LiaraClient, id: string): Promise<Backup[]> {
  return (await client.get(`${d(id)}/backups`, BackupsResponseSchema)).backups;
}

/** [V] POST /v1/databases/{id}/backups */
export async function createDatabaseBackup(client: LiaraClient, id: string): Promise<void> {
  await client.post(`${d(id)}/backups`, AnyBodySchema);
}

/** [V] POST /v1/databases/{id}/backups/{name}/download -> {link} */
export async function getDatabaseBackupLink(client: LiaraClient, id: string, backupName: string): Promise<string> {
  return (await client.post(`${d(id)}/backups/${seg(backupName)}/download`, BackupLinkSchema)).link;
}

/** [V] GET /v1/databases/{id}/metrics/summary */
export function getDatabaseMetricsSummary(client: LiaraClient, id: string): Promise<MetricsSummary> {
  return client.get(`${d(id)}/metrics/summary`, MetricsSummarySchema);
}

/** [V] GET /v1/databases/{id}/metrics/{cpu|memory|network-receive|network-transmit}?since= (unit [VAL]) */
export function getDatabaseMetricSeries(client: LiaraClient, id: string, metric: MetricName, since: number): Promise<MetricSeries> {
  return client.get(`${d(id)}/metrics/${metric}`, MetricSeriesSchema, { query: { since } });
}

/** [V] GET /v1/databases/{hostname}/events?search&start&end (path param is the hostname in the spec). */
export async function getDatabaseEvents(
  client: LiaraClient,
  hostname: string,
  q: { search?: string; start?: number; end?: number; signal?: AbortSignal } = {},
): Promise<LogLine[]> {
  const raw = await client.get(`${d(hostname)}/events`, z.unknown(), { query: { search: q.search, start: q.start, end: q.end }, signal: q.signal });
  return parseRuntimeLogs(raw);
}
