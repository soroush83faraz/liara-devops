// Domain doctor: pure mapping from what Liara returned to what the UI may claim. The rule is simple: DNS is
// never described as configured until a `check` response (not the list) says so.
import type { DnsRecordDto, DnsRecordKind, DomainDto } from "./dto";

/** Domain suffixes Liara does not accept (free TLDs) [VAL: from Liara's docs, not re-verified live]. */
export const RESTRICTED_TLDS = ["tk", "ml", "ga", "cf", "gq"] as const;

const SECOND_LEVEL_IR = new Set(["co", "ac", "org", "net", "gov", "id", "sch"]);

export function tldOf(name: string): string {
  const parts = name.toLowerCase().replace(/\.$/, "").split(".");
  return parts[parts.length - 1] ?? "";
}

export function restrictedTld(name: string): string | null {
  const tld = tldOf(name);
  return (RESTRICTED_TLDS as readonly string[]).includes(tld) ? tld : null;
}

export function isIrDomain(name: string): boolean {
  return tldOf(name) === "ir";
}

/** `example.com` / `example.co.ir` style names (a CNAME cannot sit on these at most DNS providers). */
export function isLikelyApex(name: string): boolean {
  const parts = name.toLowerCase().split(".");
  if (parts.length === 2) return true;
  return parts.length === 3 && parts[2] === "ir" && SECOND_LEVEL_IR.has(parts[1]);
}

export type DomainInputProblem = "empty" | "invalid" | "wildcard" | "restricted_tld" | "too_long";
export type DomainInputResult =
  | { ok: true; name: string; unicodeChanged: boolean }
  | { ok: false; reason: DomainInputProblem; tld?: string };

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Accepts what people paste: `https://Shop.Example.ir/path`, trailing dots, IDN. Returns the lowercase
 * ASCII (punycode) host or the reason it cannot be used. Wildcards are rejected here (guidance explains why).
 */
export function normalizeDomainInput(input: string): DomainInputResult {
  let s = input.trim().toLowerCase();
  if (s === "") return { ok: false, reason: "empty" };
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/\.$/, "");
  if (s.startsWith("*.")) return { ok: false, reason: "wildcard" };
  if (s === "" || s.includes("@") || s.includes(":") || /\s/.test(s)) return { ok: false, reason: "invalid" };
  let host: string;
  try {
    host = new URL(`http://${s}`).hostname;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (host.length > 253) return { ok: false, reason: "too_long" };
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { ok: false, reason: "invalid" };
  const tld = restrictedTld(host);
  if (tld) return { ok: false, reason: "restricted_tld", tld };
  return { ok: true, name: host, unicodeChanged: host !== s };
}

/** Names accepted by the audit trail / typed-name checks contain no `*`; wildcard domains map to `wildcard.<rest>`. */
export function domainTargetName(name: string): string {
  return name.startsWith("*.") ? `wildcard.${name.slice(2)}` : name;
}

export interface DomainGuidance {
  ir: boolean;
  restrictedTld: string | null;
  wildcard: boolean;
  apex: boolean;
}

export function domainGuidance(name: string): DomainGuidance {
  return {
    ir: isIrDomain(name),
    restrictedTld: restrictedTld(name),
    wildcard: name.startsWith("*."),
    apex: isLikelyApex(name.replace(/^\*\./, "")),
  };
}

/* ------------------------------------------------------------------ records */

/**
 * Records straight from the Liara domain object. `CNameRecord` and `verificationCode` are the fields named in
 * the API; an ACME CNAME is surfaced only when the response carries a field whose name contains "acme"
 * (the exact field is unverified [VAL], so its source key is kept for display).
 */
export function extractDnsRecords(domain: Record<string, unknown>): DnsRecordDto[] {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const records: DnsRecordDto[] = [
    { kind: "cname", value: str(domain.CNameRecord), sourceKey: "CNameRecord" },
    { kind: "verification", value: str(domain.verificationCode), sourceKey: "verificationCode" },
  ];
  for (const [k, v] of Object.entries(domain)) {
    if (/acme/i.test(k) && str(v)) {
      records.push({ kind: "acme", value: str(v), sourceKey: k });
      break;
    }
  }
  return records;
}

export type RecordState = "not_checked" | "confirmed" | "pending" | "unavailable";

export interface CheckSnapshot {
  status?: string;
  certificatesStatus?: string;
}

const isActive = (v: string | undefined): boolean => typeof v === "string" && v.trim().toUpperCase() === "ACTIVE";

/**
 * State of one record. `check` is null until the user pressed «check» in this session; the list response never
 * counts. Only an explicit ACTIVE from Liara confirms; any other value (including unknown enums) stays pending.
 */
export function recordState(kind: DnsRecordKind, value: string | null, check: CheckSnapshot | null): RecordState {
  if (value === null) return "unavailable";
  if (check === null) return "not_checked";
  const ok = kind === "acme" ? isActive(check.certificatesStatus) : isActive(check.status);
  return ok ? "confirmed" : "pending";
}

export type DnsVerdict = "not_checked" | "confirmed" | "pending";
export function dnsVerdict(check: CheckSnapshot | null): DnsVerdict {
  if (check === null) return "not_checked";
  return isActive(check.status) ? "confirmed" : "pending";
}

export type SslState = "none" | "pending" | "active";
export function sslState(certificatesStatus: string | undefined): SslState {
  if (!certificatesStatus || certificatesStatus.trim() === "") return "none";
  return isActive(certificatesStatus) ? "active" : "pending";
}

export const REDIRECT_STATUSES = [301, 302] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];

/** Redirect target: a hostname or an http(s) URL without credentials; never the domain itself. */
export function validateRedirectTarget(target: string, own: string): { ok: true; value: string } | { ok: false } {
  const v = target.trim();
  if (v === "" || v.length > 2048 || /\s/.test(v)) return { ok: false };
  let host: string;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
      const u = new URL(v);
      if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return { ok: false };
      host = u.hostname;
    } else {
      host = new URL(`http://${v}`).hostname;
      if (v.includes("/") || v.includes("@") || v.includes(":")) return { ok: false };
    }
  } catch {
    return { ok: false };
  }
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { ok: false };
  if (host === own.toLowerCase()) return { ok: false };
  return { ok: true, value: v };
}

export function domainStateSnapshot(d: Pick<DomainDto, "status" | "certificatesStatus">): CheckSnapshot {
  return { status: d.status, certificatesStatus: d.certificatesStatus };
}
