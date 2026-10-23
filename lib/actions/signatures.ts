// Error signatures checked after an action: "is the error that motivated the change gone?". Derived from the
// proposal's cited observations when available, otherwise from the action type. Matching reuses the evidence
// engine's pure parsers so detection is identical to the investigation that produced the proposal.
import type { ActionParams } from "@/lib/contracts/action";
import type { Observation } from "@/lib/contracts/observation";
import { parseConnection } from "@/lib/evidence/extract/connection";
import { parseCrashHead } from "@/lib/evidence/extract/crash";
import { parseMissingEnv } from "@/lib/evidence/extract/missing-env";
import { classifyOom } from "@/lib/evidence/extract/oom";
import { parseListen } from "@/lib/evidence/extract/port-mismatch";

export type ErrorSignature =
  | { kind: "missing_env"; key: string }
  | { kind: "connection_error"; host?: string }
  | { kind: "port_mismatch"; port?: number }
  | { kind: "crash"; errorType?: string }
  | { kind: "oom" };

const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 253 ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 65536 ? v : undefined);

/** Signatures from the cited observations (ids in `evidenceIds` only). */
export function signaturesFromEvidence(observations: readonly Observation[], evidenceIds: readonly string[]): ErrorSignature[] {
  const cited = new Set(evidenceIds);
  const out: ErrorSignature[] = [];
  for (const o of observations) {
    if (!cited.has(o.id)) continue;
    const p = o.params;
    if (o.kind === "missing_env" && str(p.key)) out.push({ kind: "missing_env", key: str(p.key) as string });
    else if (o.kind === "connection_error") out.push({ kind: "connection_error", host: str(p.dbHostname) ?? str(p.host) });
    else if (o.kind === "port_mismatch") out.push({ kind: "port_mismatch", port: num(p.configuredPort) });
    else if (o.kind === "crash") out.push({ kind: "crash", errorType: str(p.errorType) });
    else if (o.kind === "oom") out.push({ kind: "oom" });
  }
  return out;
}

/** Type defaults, always added for runtime actions: a crash or an OOM after the change means "not fixed". */
export function defaultSignatures(params: ActionParams): ErrorSignature[] {
  const generic: ErrorSignature[] = [{ kind: "crash" }, { kind: "oom" }];
  switch (params.type) {
    case "set_env":
      return [...params.changes.filter((c) => c.op === "set").map((c) => ({ kind: "missing_env" as const, key: c.key })), ...generic];
    case "wire_db":
      return [{ kind: "connection_error", host: params.db }, ...generic];
    case "update_port":
      return [{ kind: "port_mismatch", port: params.port }, ...generic];
    default:
      return generic;
  }
}

export function signatureId(s: ErrorSignature): string {
  switch (s.kind) {
    case "missing_env":
      return `missing_env:${s.key}`;
    case "connection_error":
      return `connection_error:${s.host ?? "*"}`;
    case "port_mismatch":
      return `port_mismatch:${s.port ?? "*"}`;
    case "crash":
      return `crash:${s.errorType ?? "*"}`;
    case "oom":
      return "oom";
  }
}

export function dedupeSignatures(list: readonly ErrorSignature[]): ErrorSignature[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const id = signatureId(s);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function hostMatches(found: string | undefined, expected: string): boolean {
  if (!found) return false;
  const f = found.toLowerCase();
  const e = expected.toLowerCase();
  return f === e || f.startsWith(`${e}.`);
}

const EADDRINUSE = /EADDRINUSE|address already in use/i;

export function matchesSignature(s: ErrorSignature, message: string): boolean {
  switch (s.kind) {
    case "missing_env":
      return parseMissingEnv(message).some((h) => h.key === s.key);
    case "connection_error": {
      const hit = parseConnection(message);
      return hit !== undefined && (s.host === undefined || hostMatches(hit.host, s.host));
    }
    case "port_mismatch": {
      if (EADDRINUSE.test(message)) return true;
      const listen = parseListen(message);
      return s.port !== undefined && listen !== undefined && listen.port !== s.port;
    }
    case "crash": {
      const head = parseCrashHead(message);
      return head !== undefined && (s.errorType === undefined || head.type === s.errorType);
    }
    case "oom": {
      // A plain SIGKILL/exit 137 also happens when a restart replaces the container: only real OOM counts.
      const scope = classifyOom(message);
      return scope === "container" || scope === "heap";
    }
  }
}
