// Server-only HTTP health probe of an app's OWN public address. The target is always derived from Liara
// (default sub-domain / active custom domain); callers can never supply a URL. Reusable by the evidence engine.
//
// SSRF / DNS rebinding: the host name is resolved ONCE, every address is checked against the IP guard, and the
// connection is then made to that validated address only. `fetch` cannot be pinned without undici's dispatcher
// (not a dependency), so the probe uses node:https with a socket-level `lookup` that always answers with the
// pre-validated address: a second DNS answer (rebinding to 127.0.0.1 / 169.254.169.254) is never consulted. The
// TLS server name and the Host header stay the host NAME, so certificate validation is unchanged.
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP, isIPv6, type LookupFunction } from "node:net";
import { getApp, listDomains, type LiaraClient } from "@/lib/liara";
import type { Domain } from "@/lib/liara/schemas";
import { isAllowedHostname, isPrivateAddress } from "./ip-guard";
import type { TtlCache } from "./ttl-cache";
import type { ProbeErrorCode, ProbeResult } from "./types";
import { defaultAppUrl } from "./urls";

export const PROBE_TIMEOUT_MS = 6_000;
export const PROBE_MAX_BYTES = 64 * 1024;
export const PROBE_MAX_REDIRECTS = 3;

/** What the probe needs from one GET: the status and, for a redirect, the Location header. */
export interface ProbeResponse {
  status: number;
  location: string | null;
}

export interface ProbeTransportInit {
  /** The validated address to connect to; the transport must never resolve the host name itself. */
  address: string;
  signal: AbortSignal;
  maxBytes: number;
  headers: Record<string, string>;
}

/** One GET of `url`, connecting to `init.address` (see `pinnedGet`). Injectable for tests. */
export type ProbeTransport = (url: URL, init: ProbeTransportInit) => Promise<ProbeResponse>;

/** A socket-level DNS lookup that answers every query with the one pre-validated address (never re-resolves). */
export function pinnedLookup(address: string): LookupFunction {
  const family = isIPv6(address) ? 6 : 4;
  return ((_hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (err: Error | null, address: unknown, family?: number) => void;
    if (typeof options === "object" && options !== null && (options as { all?: boolean }).all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as LookupFunction;
}

/**
 * GET over node:http(s) pinned to `init.address`: Host header and TLS SNI/certificate check use the URL's host
 * name, the TCP connection goes to the validated address (custom `lookup`, no shared agent / socket reuse).
 * Reads at most `maxBytes` of the body, then closes the connection.
 */
export function pinnedGet(url: URL, init: ProbeTransportInit, requestImpl?: typeof httpsRequest): Promise<ProbeResponse> {
  if (isIP(init.address) === 0) return Promise.reject(Object.assign(new Error("pinned address is not an IP"), { code: "EINVAL" }));
  const request = requestImpl ?? (url.protocol === "https:" ? httpsRequest : httpRequest);
  const options: RequestOptions & { autoSelectFamily?: boolean } = {
    protocol: url.protocol,
    host: url.hostname,
    ...(isIP(url.hostname) === 0 ? { servername: url.hostname } : {}),
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: init.headers,
    lookup: pinnedLookup(init.address),
    family: isIPv6(init.address) ? 6 : 4,
    autoSelectFamily: false,
    agent: false,
    signal: init.signal,
  };
  return new Promise<ProbeResponse>((resolve, reject) => {
    let settled = false;
    const finish = (r: ProbeResponse) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const req = request(options, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      const done = () => {
        finish({ status, location });
        res.destroy();
      };
      if (status >= 300 && status < 400) return done();
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total >= init.maxBytes) done();
      });
      res.on("end", done);
      res.on("error", fail);
    });
    req.on("error", fail);
    req.end();
  });
}

export interface ProbeDeps {
  /** The GET implementation (default `pinnedGet`). Always handed the validated address to connect to. */
  transport?: ProbeTransport;
  /** Resolve a host name to its addresses (injectable for tests). */
  resolve?: (host: string) => Promise<string[]>;
  now?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
  /** Optional cache of the resolved probe host (key `cacheKey`), e.g. 5 minutes per account+app. */
  targetCache?: TtlCache<string | null>;
  cacheKey?: string;
}

const defaultResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Pick the host to probe from Liara's own data: an active (certificate ACTIVE), non-redirecting custom domain first,
 * else the default sub-domain unless Liara says it is disabled. Returns a host name or undefined.
 */
export function pickProbeHost(
  name: string,
  domains: ReadonlyArray<Pick<Domain, "name" | "certificatesStatus" | "redirectTo">>,
  defaultSubdomain: boolean | undefined,
): string | undefined {
  const custom = domains.find(
    (d) => d.name && !d.redirectTo && d.certificatesStatus?.toUpperCase() === "ACTIVE" && isAllowedHostname(d.name),
  );
  if (custom?.name) return custom.name.toLowerCase().replace(/\.$/, "");
  if (defaultSubdomain === false) return undefined;
  const url = defaultAppUrl(name);
  return url ? new URL(url).hostname : undefined;
}

/** Resolves the probe host for an app from Liara (getApp + listDomains). Never takes a URL as input. */
export async function resolveProbeHost(liara: LiaraClient, name: string, deps: ProbeDeps = {}): Promise<string | undefined> {
  const load = async (): Promise<string | null> => {
    const app = await getApp(liara, name);
    let domains: Domain[] = [];
    try {
      domains = await listDomains(liara, name);
    } catch {
      // custom domains are an optimisation; fall back to the default sub-domain
    }
    return pickProbeHost(name, domains, app.defaultSubdomain) ?? null;
  };
  const host = deps.targetCache && deps.cacheKey ? await deps.targetCache.get(deps.cacheKey, load) : await load();
  return host ?? undefined;
}

export function mapFetchError(error: unknown): ProbeErrorCode {
  const e = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  const code = e?.cause?.code ?? e?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "refused";
  if (/CERT|TLS|SSL|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED/i.test(code)) return "tls";
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return "timeout";
  return "network";
}

/** Core: GET `https://host/` with guards. Exported separately so the SSRF rules are testable without Liara. */
export async function probeHost(host: string, deps: ProbeDeps = {}): Promise<ProbeResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const done = (partial: Omit<ProbeResult, "latencyMs" | "checkedAt">): ProbeResult => ({
    ...partial,
    latencyMs: Math.max(0, now() - started),
    checkedAt: new Date(now()).toISOString(),
  });
  if (!isAllowedHostname(host)) return done({ ok: false, error: "blocked_address" });

  const transport = deps.transport ?? pinnedGet;
  const resolve = deps.resolve ?? defaultResolve;
  const maxBytes = deps.maxBytes ?? PROBE_MAX_BYTES;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? PROBE_TIMEOUT_MS);

  try {
    // Resolve ONCE and refuse hosts with any private/loopback/metadata address (a custom domain may point anywhere).
    const addresses = await resolve(host);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) return done({ ok: false, error: "blocked_address" });
    // Every hop connects to this validated address; same-host redirects never trigger a new resolution.
    const address = addresses[0];

    let url = new URL(`https://${host}/`);
    for (let hop = 0; hop <= PROBE_MAX_REDIRECTS; hop++) {
      const res = await transport(url, { address, signal, maxBytes, headers: { "User-Agent": "hamyar-health-probe/1.0", Accept: "*/*" } });
      const location = res.status >= 300 && res.status < 400 ? res.location : null;
      if (location) {
        let next: URL | undefined;
        try {
          next = new URL(location, url);
        } catch {
          next = undefined;
        }
        // Follow only https redirects that stay on the same host. Anything else is not followed: the 3xx
        // answer itself proves the app responds.
        if (next && next.protocol === "https:" && next.hostname === url.hostname && !next.username && !next.password && next.port === "") {
          if (hop === PROBE_MAX_REDIRECTS) return done({ ok: false, status: res.status, error: "too_many_redirects" });
          url = next;
          continue;
        }
        return done({ ok: true, status: res.status });
      }
      return done({ ok: res.status < 400, status: res.status });
    }
    return done({ ok: false, error: "too_many_redirects" });
  } catch (error) {
    return done({ ok: false, error: mapFetchError(error) });
  }
}

/** Probe an app by name. The URL is resolved server-side from Liara; see `pickProbeHost`. */
export async function probeApp(liara: LiaraClient, name: string, deps: ProbeDeps = {}): Promise<ProbeResult> {
  const now = deps.now ?? Date.now;
  const host = await resolveProbeHost(liara, name, deps);
  if (!host) return { ok: false, latencyMs: 0, checkedAt: new Date(now()).toISOString(), error: "no_url" };
  return probeHost(host, deps);
}
