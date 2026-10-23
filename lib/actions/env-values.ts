// Resolves env changes (which never carry values) into concrete values, server-side, at execution time.
// SECURITY: values only flow from (a) the user's request, (b) the CSPRNG, (c) Liara itself (another env key
// of the same app, or a database in the SAME private network). A model can name a source but never a value.
import { getDatabase, getDatabaseCredentials, type AppDetail, type EnvOp, type LiaraClient } from "@/lib/liara";
import { isExposedEnvKey, type DbField, type EnvChange } from "@/lib/contracts/env";
import { ActionError } from "./errors";
import { resolveDatabase, sameNetwork } from "./liara-refs";
import type { Run } from "./run";
import { generateSecret, type SecretSet } from "./secrets";

const DEFAULT_PORT: Readonly<Record<string, number>> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongodb: 27017,
  redis: 6379,
  mssql: 1433,
  rabbitmq: 5672,
  elasticsearch: 9200,
  clickhouse: 9000,
};
const URL_SCHEME: Readonly<Record<string, string>> = {
  postgres: "postgresql",
  mysql: "mysql",
  mariadb: "mysql",
  mongodb: "mongodb",
  redis: "redis",
  rabbitmq: "amqp",
  elasticsearch: "http",
  clickhouse: "clickhouse",
};
const NO_DB_PATH = new Set(["redis", "rabbitmq", "elasticsearch"]);

export interface ConnectionParts {
  user?: string;
  password?: string;
  host?: string;
  port?: string;
  database?: string;
}

/** Private connection URL for an engine [VAL formats]; undefined when the engine has no plain URL form (mssql). */
export function buildConnectionUrl(engine: string | undefined, p: ConnectionParts): string | undefined {
  const scheme = engine ? URL_SCHEME[engine] : undefined;
  if (!scheme || !engine || !p.host || !p.port) return undefined;
  const enc = encodeURIComponent;
  const auth = p.user || p.password ? `${enc(p.user ?? "")}:${enc(p.password ?? "")}@` : "";
  const path = p.database && !NO_DB_PATH.has(engine) ? `/${enc(p.database)}` : "";
  const query = engine === "mongodb" ? "?authSource=admin" : "";
  return `${scheme}://${auth}${p.host}:${p.port}${path}${query}`;
}

export interface DbFieldSource {
  db: string;
  engine?: string;
  networkName?: string;
  values: Partial<Record<DbField, string>>;
}

/**
 * Field values of a database for an app. Refuses (different_network) unless app and DB are provably in the
 * same private network: the private hostname is only reachable there, and copying credentials into an app
 * that cannot use them is never what the user meant. Password and URL go into `secrets` before returning.
 */
export async function loadDbFields(liara: LiaraClient, app: AppDetail, dbName: string, secrets: SecretSet): Promise<DbFieldSource> {
  const { summary, ref } = await resolveDatabase(liara, dbName);
  const detail = await getDatabase(liara, ref);
  if (!sameNetwork(app.network, detail.network)) {
    throw new ActionError("different_network", { details: { app: app.project_id ?? "", db: dbName } });
  }
  const creds = await getDatabaseCredentials(liara, ref);
  secrets.add(creds.password);
  const engine = summary.type ?? detail.type;
  const portNum = creds.internalPort ?? detail.internalPort ?? summary.internalPort ?? (engine ? DEFAULT_PORT[engine] : undefined);
  const parts: ConnectionParts = {
    host: creds.hostname ?? summary.hostname,
    port: portNum === undefined ? undefined : String(portNum),
    user: creds.username,
    password: creds.password,
    database: creds.dbName,
  };
  const url = buildConnectionUrl(engine, parts);
  secrets.add(url);
  return {
    db: dbName,
    engine,
    networkName: detail.network?.name,
    values: { host: parts.host, port: parts.port, user: parts.user, password: parts.password, database: parts.database, url },
  };
}

export interface EnvResolution {
  ops: EnvOp[];
  report: {
    set: string[];
    unset: string[];
    generated: string[];
    userProvided: string[];
    copied: Array<{ key: string; from: string }>;
  };
}

export async function resolveEnvChanges(run: Run, app: AppDetail, changes: readonly EnvChange[]): Promise<EnvResolution> {
  const ops: EnvOp[] = [];
  const report: EnvResolution["report"] = { set: [], unset: [], generated: [], userProvided: [], copied: [] };
  const dbs = new Map<string, Promise<DbFieldSource>>();
  const userValues = run.opts.userValues ?? {};

  for (const c of changes) {
    if (c.op === "unset") {
      ops.push({ op: "unset", key: c.key });
      report.unset.push(c.key);
      continue;
    }
    let value: string;
    if (c.valueSource === "user") {
      const v = Object.prototype.hasOwnProperty.call(userValues, c.key) ? userValues[c.key] : undefined;
      if (typeof v !== "string") throw new ActionError("missing_user_value", { details: { key: c.key } });
      value = v;
      run.secrets.add(v);
      report.userProvided.push(c.key);
    } else if (c.valueSource === "generated") {
      value = generateSecret(c.generator);
      run.secrets.add(value);
      report.generated.push(c.key);
    } else {
      // Re-checked here although the schema refines it: a copied secret must never land in a browser bundle.
      if (isExposedEnvKey(c.key)) throw new ActionError("public_key_forbidden", { details: { key: c.key } });
      if (c.from.kind === "app_env") {
        const fromKey = c.from.key;
        const src = app.envs.find((e) => e.key === fromKey);
        if (!src) throw new ActionError("env_source_missing", { details: { key: c.key, from: `env:${fromKey}` } });
        value = src.value;
        run.secrets.add(value);
        report.copied.push({ key: c.key, from: `env:${fromKey}` });
      } else {
        const { name, field } = c.from;
        let pending = dbs.get(name);
        if (!pending) {
          pending = loadDbFields(run.liara, app, name, run.secrets);
          dbs.set(name, pending);
        }
        const v = (await pending).values[field];
        if (v === undefined) throw new ActionError("env_source_missing", { details: { key: c.key, from: `db:${name}.${field}` } });
        value = v;
        report.copied.push({ key: c.key, from: `db:${name}.${field}` });
      }
    }
    ops.push({ op: "set", key: c.key, value });
    report.set.push(c.key);
  }
  return { ops, report };
}
