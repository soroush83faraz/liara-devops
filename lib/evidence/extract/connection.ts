// connection: the app cannot reach a host (database or external dependency).
import { mergeOccurrence, occurrenceParams, type Occurrence } from "../lines";
import { draft, SIG } from "../observe";
import type { DbFacts, DraftObservation, ExtractContext, LogGroup } from "../types";

const HOST = String.raw`(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9_][A-Za-z0-9_.-]{0,252})`;

export interface ConnectionHit {
  code: string;
  host?: string;
  port?: number;
  engine?: string;
}

// Ordered: specific driver messages first, then Node errno forms, then bare codes.
const PATTERNS: Array<{ re: RegExp; code?: string; engine?: string }> = [
  { re: new RegExp(String.raw`connect (?<code>ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET) (?<host>${HOST}):(?<port>\d{1,5})`) },
  { re: new RegExp(String.raw`getaddrinfo (?<code>ENOTFOUND|EAI_AGAIN) (?<host>${HOST})`) },
  { re: new RegExp(String.raw`Can't connect to (?:local )?MySQL server (?:on|through) '?(?<host>${HOST})'?(?::(?<port>\d{1,5}))?`), code: "MYSQL_CONNECT", engine: "mysql" },
  { re: new RegExp(String.raw`Unknown MySQL server host '(?<host>${HOST})'`), code: "ENOTFOUND", engine: "mysql" },
  { re: new RegExp(String.raw`connection to server at "(?<host>${HOST})"(?: \([^)]{0,64}\))?, port (?<port>\d{1,5}) failed`), code: "PG_CONNECT", engine: "postgres" },
  { re: new RegExp(String.raw`could not translate host name "(?<host>${HOST})"`), code: "ENOTFOUND", engine: "postgres" },
  { re: new RegExp(String.raw`could not connect to server(?:[^\n]{0,80}?host "(?<host>${HOST})")?`), code: "PG_CONNECT", engine: "postgres" },
  { re: new RegExp(String.raw`Redis connection to (?<host>${HOST}):(?<port>\d{1,5}) failed`), code: "REDIS_CONNECT", engine: "redis" },
  { re: /Mongo(?:Server)?(?:Selection|Network)Error/, code: "MONGO_CONNECT", engine: "mongodb" },
  { re: /SQLSTATE\[HY000\] \[2002\]/, code: "MYSQL_CONNECT", engine: "mysql" },
  { re: /\[Errno (?:111|-2|-3|110)\][^\n]{0,60}(?:Connection refused|Name or service not known|Temporary failure in name resolution|timed out)/, code: "PY_SOCKET" },
  { re: new RegExp(String.raw`\b(?<code>ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)\b`) },
];

const PORT_ENGINE: Record<number, string> = { 3306: "mysql", 5432: "postgres", 27017: "mongodb", 6379: "redis", 1433: "mssql", 9200: "elasticsearch", 5672: "rabbitmq", 8123: "clickhouse", 9000: "clickhouse" };
const TEXT_ENGINE: Array<[RegExp, string]> = [
  [/\b(?:mysql|mariadb)\b/i, "mysql"],
  [/\b(?:postgres(?:ql)?|psql|pg(?:pool)?)\b/i, "postgres"],
  [/\bmongo/i, "mongodb"],
  [/\b(?:redis|ioredis)\b/i, "redis"],
  [/\b(?:mssql|sqlserver|tedious)\b/i, "mssql"],
];

export function parseConnection(message: string): ConnectionHit | undefined {
  for (const { re, code, engine } of PATTERNS) {
    const m = re.exec(message);
    if (!m) continue;
    const g = m.groups ?? {};
    const port = g.port ? Number(g.port) : undefined;
    const host = g.host?.replace(/^\[|\]$/g, "").replace(/[.,;]+$/, "");
    const eng = engine ?? (port ? PORT_ENGINE[port] : undefined) ?? TEXT_ENGINE.find(([r]) => r.test(message))?.[1];
    return {
      code: g.code ?? code ?? "CONNECT",
      ...(host ? { host } : {}),
      ...(port && port > 0 && port < 65536 ? { port } : {}),
      ...(eng ? { engine: eng } : {}),
    };
  }
  return undefined;
}

const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/;

/** Matches a target host to a known DB (exact name or `<hostname>.<anything>`). */
export function matchDb(host: string | undefined, dbs: readonly DbFacts[]): DbFacts | undefined {
  if (!host) return undefined;
  const h = host.toLowerCase();
  return dbs.find((d) => {
    const n = d.hostname.toLowerCase();
    return h === n || h.startsWith(`${n}.`);
  });
}

export type TargetClass = "db" | "local" | "external" | "unknown";

export function classifyTarget(hit: ConnectionHit, dbs: readonly DbFacts[]): TargetClass {
  if (hit.host && LOCAL_HOST.test(hit.host)) return "local";
  if (matchDb(hit.host, dbs) || hit.engine) return "db";
  if (hit.host && /[a-z]\.[a-z]{2,}$/i.test(hit.host)) return "external";
  return "unknown";
}

export interface ConnectionTarget {
  hit: ConnectionHit;
  occ: Occurrence;
}

/** Distinct (code, host, port) targets in first-appearance order. */
export function findConnectionTargets(groups: readonly LogGroup[]): ConnectionTarget[] {
  const map = new Map<string, ConnectionTarget>();
  for (const g of groups) {
    const hit = parseConnection(g.message);
    if (!hit) continue;
    const id = `${hit.code}|${hit.host ?? ""}|${hit.port ?? ""}`;
    const prev = map.get(id);
    map.set(id, { hit: prev?.hit ?? hit, occ: mergeOccurrence(prev?.occ, g) });
  }
  return [...map.values()];
}

export function extractConnection(ctx: ExtractContext): DraftObservation[] {
  return findConnectionTargets(ctx.logGroups).map(({ hit, occ }) => {
    const db = matchDb(hit.host, ctx.dbs);
    const target = classifyTarget(hit, ctx.dbs);
    return draft(
      "connection_error",
      "liara:logs",
      `evidence.connection.${target}`,
      "error",
      occ.sample,
      {
        code: hit.code,
        host: hit.host,
        port: hit.port,
        engine: hit.engine ?? db?.engine,
        target,
        dbHostname: db?.hostname,
        ...occurrenceParams(occ),
        [SIG]: true,
      },
      occ.firstTs,
    );
  });
}
