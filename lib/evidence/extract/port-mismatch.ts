// port-mismatch: EADDRINUSE, app listening on a port other than the configured one, loopback-only bind,
// or the probe is refused while the applet runs.
import { mergeOccurrence, occurrenceParams, type Occurrence } from "../lines";
import { draft, SIG } from "../observe";
import type { DraftObservation, ExtractContext, LogGroup } from "../types";

const EADDRINUSE = /EADDRINUSE|address already in use/i;
const EADDRINUSE_PORT = new RegExp(String.raw`(?:EADDRINUSE|address already in use)[^\n]{0,60}?:(?<port>\d{2,5})\b`, "i");

// "Server listening on port 8080", "listening at http://0.0.0.0:3000", "Uvicorn running on http://127.0.0.1:8000",
// "started server on 0.0.0.0:3000". The verb must precede the port within 60 chars to avoid matching DB targets.
const LISTEN =
  new RegExp(String.raw`\b(?:listening|listen(?:s|ing)?|running|started|serving|ready|up)\b[^\n]{0,60}?(?:\bport\s*[:=]?\s*|(?<host>0\.0\.0\.0|localhost|127\.0\.0\.1|\[::1?\]|[A-Za-z0-9.-]+):)(?<port>\d{2,5})\b`, "i");
// Next.js prints "- Local: http://localhost:3000" even when bound to all interfaces: never a loopback signal.
const NEXT_LOCAL = /^\s*[-▲]?\s*Local:/i;
const LOOPBACK = /^(?:127\.0\.0\.1|localhost|\[::1\])$/i;

export interface ListenHit {
  port: number;
  host?: string;
}

export function parseListen(message: string): ListenHit | undefined {
  if (EADDRINUSE.test(message)) return undefined;
  if (/\b(?:ECONNREFUSED|ETIMEDOUT|connect(?:ing|ion)? to)\b/i.test(message)) return undefined;
  const m = LISTEN.exec(message);
  if (!m?.groups?.port) return undefined;
  const port = Number(m.groups.port);
  if (!(port > 0 && port < 65536)) return undefined;
  return { port, ...(m.groups.host ? { host: m.groups.host } : {}) };
}

function collect(groups: readonly LogGroup[], pick: (g: LogGroup) => string | undefined): Map<string, Occurrence> {
  const map = new Map<string, Occurrence>();
  for (const g of groups) {
    const id = pick(g);
    if (id !== undefined) map.set(id, mergeOccurrence(map.get(id), g));
  }
  return map;
}

export function extractPortMismatch(ctx: ExtractContext): DraftObservation[] {
  const out: DraftObservation[] = [];
  const configured = ctx.app?.configuredPort;

  const inUse = collect(ctx.logGroups, (g) => (EADDRINUSE.test(g.message) ? (EADDRINUSE_PORT.exec(g.message)?.groups?.port ?? "") : undefined));
  for (const [port, occ] of inUse) {
    out.push(
      draft("port_mismatch", "liara:logs", "evidence.port.eaddrinuse", "error", occ.sample, {
        port: port ? Number(port) : undefined,
        configuredPort: configured,
        ...occurrenceParams(occ),
        [SIG]: true,
      }, occ.firstTs),
    );
  }

  const listens = new Map<string, { hit: ListenHit; occ: Occurrence }>();
  for (const g of ctx.logGroups) {
    const hit = parseListen(g.message);
    if (!hit) continue;
    const loopback = Boolean(hit.host && LOOPBACK.test(hit.host) && !NEXT_LOCAL.test(g.message));
    const id = `${hit.port}|${loopback ? "lo" : ""}`;
    const prev = listens.get(id);
    listens.set(id, { hit: { port: hit.port, ...(loopback ? { host: hit.host } : {}) }, occ: mergeOccurrence(prev?.occ, g) });
  }
  for (const { hit, occ } of listens.values()) {
    if (hit.host) {
      out.push(
        draft("port_mismatch", "liara:logs", "evidence.port.loopback_bind", "error", occ.sample, {
          listenPort: hit.port, bindHost: hit.host, configuredPort: configured, ...occurrenceParams(occ), [SIG]: true,
        }, occ.firstTs),
      );
    } else if (configured !== undefined && hit.port !== configured) {
      out.push(
        draft("port_mismatch", "liara:logs", "evidence.port.listen_differs", "error", occ.sample, {
          listenPort: hit.port, configuredPort: configured, ...occurrenceParams(occ), [SIG]: true,
        }, occ.firstTs),
      );
    } else if (configured !== undefined) {
      // Contradicting evidence for a wrong-port hypothesis.
      out.push(
        draft("config", "liara:logs", "evidence.config.port_matches", "info", occ.sample, {
          listenPort: hit.port, configuredPort: configured, ...occurrenceParams(occ),
        }, occ.firstTs),
      );
    }
  }

  const p = ctx.probe;
  const running = ctx.applets.some((a) => /running/i.test(a.state ?? ""));
  const listenElsewhere = out.some((o) => o.summary === "evidence.port.listen_differs" || o.summary === "evidence.port.loopback_bind");
  if (p && isUnreachable(p) && (running || listenElsewhere)) {
    // A gateway error/refusal while the container runs (or while it logs another port) is what a wrong port looks like.
    out.push(
      draft("port_mismatch", "probe", running ? "evidence.port.probe_refused_while_running" : "evidence.port.probe_unreachable", "warn",
        `probe ${p.status ?? p.error ?? "failed"}${running ? " while applet running" : ""}`,
        { probeStatus: p.status, probeError: p.error, configuredPort: configured, appletRunning: running, [SIG]: false }, p.checkedAt),
    );
  }
  return out;
}

/** The platform could not reach the container: refused/timed out, or a gateway 502/503/504 (not an app 500). */
export function isUnreachable(p: NonNullable<ExtractContext["probe"]>): boolean {
  return !p.ok && (p.error === "refused" || p.error === "timeout" || (p.status !== undefined && [502, 503, 504].includes(p.status)));
}
