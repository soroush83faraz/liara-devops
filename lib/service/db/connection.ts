// Pure connection-string builders. The password is NEVER an input of the server-side builders: they emit the
// literal placeholder. The browser may call `buildConnectionString(input, password)` after an explicit reveal,
// purely to build a copy-to-clipboard value (never stored, never sent anywhere).
import type { DatabaseDetail } from "../../liara/schemas";

export const PASSWORD_PLACEHOLDER = "<PASSWORD>";

export interface ConnectionInput {
  engine: string;
  host?: string;
  port?: number;
  username?: string;
  dbName?: string;
}

const PLAIN_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const IPV6_LIKE = /^[0-9A-Fa-f:.]+$/;

/** Host part of a URL: plain DNS names/IPv4 untouched, IPv6 bracketed, anything else percent-encoded. */
export function formatHost(raw: string | undefined): string | undefined {
  const host = raw?.trim();
  if (!host) return undefined;
  if (PLAIN_HOST.test(host)) return host;
  if (host.includes(":") && IPV6_LIKE.test(host)) return `[${host}]`;
  return encodeURIComponent(host);
}

/** Valid TCP port or undefined (missing/invalid ports are omitted, never guessed). */
export function validPort(port: number | undefined): number | undefined {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

const enc = encodeURIComponent;

/** ADO.NET-style value: quoted only when it contains characters that would break the `;`-separated format. */
function adoValue(v: string): string {
  return /[;'"=\s]/.test(v) ? `'${v.replace(/'/g, "''")}'` : v;
}

type UrlScheme = { scheme: string; query?: string; userless?: boolean };

const URL_ENGINES: Record<string, UrlScheme> = {
  postgres: { scheme: "postgresql" },
  mysql: { scheme: "mysql" },
  mariadb: { scheme: "mysql" },
  mongodb: { scheme: "mongodb", query: "authSource=admin" },
  redis: { scheme: "redis" },
  clickhouse: { scheme: "clickhouse" },
  // Transport (http vs https) for Elasticsearch is not documented by Liara [VAL].
  elasticsearch: { scheme: "http" },
  rabbitmq: { scheme: "amqp" },
};

export const CONNECTION_ENGINES: readonly string[] = [...Object.keys(URL_ENGINES), "mssql"];

/**
 * Connection string for one endpoint. `password` undefined -> the `<PASSWORD>` placeholder.
 * Returns undefined when the host is missing or the engine has no known template.
 */
export function buildConnectionString(input: ConnectionInput, password?: string): string | undefined {
  const host = formatHost(input.host);
  if (!host) return undefined;
  const port = validPort(input.port);
  const pw = password ?? PASSWORD_PLACEHOLDER;
  const engine = input.engine.toLowerCase();
  const user = input.username?.trim() || undefined;
  const db = input.dbName?.trim() || undefined;

  if (engine === "mssql") {
    const parts = [`Server=${host}${port ? `,${port}` : ""}`];
    if (db) parts.push(`Database=${adoValue(db)}`);
    if (user) parts.push(`User Id=${adoValue(user)}`);
    parts.push(`Password=${password === undefined ? pw : adoValue(pw)}`, "TrustServerCertificate=true");
    return parts.join(";");
  }

  const tpl = URL_ENGINES[engine];
  if (!tpl) return undefined;
  const secret = password === undefined ? pw : enc(pw);
  // Redis has no database name in the credentials and usually no user: `redis://:<PASSWORD>@host:port`.
  const userinfo = `${user ? enc(user) : ""}:${secret}@`;
  const path = engine === "redis" || engine === "elasticsearch" || engine === "rabbitmq" ? "" : db ? `/${enc(db)}` : tpl.query ? "/" : "";
  const query = tpl.query ? `?${tpl.query}` : "";
  return `${tpl.scheme}://${userinfo}${host}${port ? `:${port}` : ""}${path}${query}`;
}

export interface ConnectionEndpointDto {
  available: boolean;
  host?: string;
  port?: number;
  /** Contains the `<PASSWORD>` placeholder, never the secret. */
  url?: string;
}

export interface DbConnectionDto {
  engine: string;
  username?: string;
  dbName?: string;
  publicNetwork: boolean;
  placeholder: typeof PASSWORD_PLACEHOLDER;
  private: ConnectionEndpointDto;
  public: ConnectionEndpointDto;
}

function endpoint(base: Omit<ConnectionInput, "host" | "port">, host: string | undefined, port: number | undefined): ConnectionEndpointDto {
  if (!host) return { available: false };
  const url = buildConnectionString({ ...base, host, port });
  return { available: true, host, ...(port ? { port } : {}), ...(url ? { url } : {}) };
}

/** Built from the credential-free detail: private `hostname:internalPort`, public `node.host:port` only when the public network is on. */
export function buildConnectionDto(
  db: Pick<DatabaseDetail, "type" | "hostname" | "internalPort" | "publicNetwork" | "node" | "port" | "username" | "dbName">,
): DbConnectionDto {
  const engine = (db.type ?? "").toLowerCase();
  const base = { engine, username: db.username, dbName: db.dbName };
  const publicOn = db.publicNetwork === true;
  return {
    engine,
    ...(db.username ? { username: db.username } : {}),
    ...(db.dbName ? { dbName: db.dbName } : {}),
    publicNetwork: publicOn,
    placeholder: PASSWORD_PLACEHOLDER,
    private: endpoint(base, db.hostname?.trim() || undefined, validPort(db.internalPort)),
    public: publicOn ? endpoint(base, db.node?.host?.trim() || undefined, validPort(db.port)) : { available: false },
  };
}
