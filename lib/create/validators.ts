// Pure name / value validators. They return an error code (a key of createFlow.validation) or null.
import { DockerImageSchema } from "@/lib/contracts/common";

export type ValidationCode =
  | "required"
  | "tooShort"
  | "tooLong"
  | "charset"
  | "edgeHyphen"
  | "startChar"
  | "imageInvalid"
  | "imageNeedsTag"
  | "portInvalid";

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Liara app names / DB hostnames: lowercase letters, digits and hyphens, a DNS label (2-63 chars). */
export function validateDnsName(raw: string): ValidationCode | null {
  const v = raw;
  if (v.length === 0) return "required";
  if (v.length < 2) return "tooShort";
  if (v.length > 63) return "tooLong";
  if (!/^[a-z0-9-]+$/.test(v)) return "charset";
  if (!/^[a-z0-9]/.test(v)) return "startChar";
  if (v.endsWith("-")) return "edgeHyphen";
  return DNS_LABEL.test(v) ? null : "charset";
}

export const validateAppName = validateDnsName;
export const validateDbName = validateDnsName;

/** Network names: letters, digits, `_` and `-`, starts alphanumeric, 3-63 chars (the Liara client requires >= 3). */
export function validateNetworkName(raw: string): ValidationCode | null {
  if (raw.length === 0) return "required";
  if (raw.length < 3) return "tooShort";
  if (raw.length > 63) return "tooLong";
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return "charset";
  if (!/^[A-Za-z0-9]/.test(raw)) return "startChar";
  return null;
}

/** `repo:tag` (or `@sha256:` digest). A bare repo is rejected so the version that runs is explicit. */
export function validateImage(raw: string): ValidationCode | null {
  const v = raw.trim();
  if (v.length === 0) return "required";
  if (!DockerImageSchema.safeParse(v).success) return "imageInvalid";
  const last = v.slice(v.lastIndexOf("/") + 1);
  return last.includes(":") || v.includes("@sha256:") ? null : "imageNeedsTag";
}

/** Port as typed by the user (digits only). */
export function validatePort(raw: string): ValidationCode | null {
  const v = raw.trim();
  if (v.length === 0) return "required";
  if (!/^\d{1,5}$/.test(v)) return "portInvalid";
  const n = Number(v);
  return n >= 1 && n <= 65535 ? null : "portInvalid";
}

const PORT_HINTS: Record<string, number> = {
  node: 3000, next: 3000, react: 80, angular: 80, vue: 80, static: 80, php: 80, laravel: 80,
  python: 8000, django: 8000, flask: 5000, dotnet: 80, go: 8080, docker: 80,
};

/** A suggestion only (shown as a hint, editable): the typical listening port of the platform. */
export function suggestPort(platform: string | undefined): number | undefined {
  return platform ? PORT_HINTS[platform] : undefined;
}

export type ArchiveKind = "zip" | "targz";

/** Archive kind by file name (the server re-checks the magic bytes). */
export function archiveKindFromName(name: string): ArchiveKind | null {
  const n = name.toLowerCase();
  if (n.endsWith(".zip")) return "zip";
  if (n.endsWith(".tar.gz") || n.endsWith(".tgz")) return "targz";
  return null;
}
