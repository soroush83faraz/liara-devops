// Pure validation of a deploy request, in the order the route enforces it (rate limit and origin run before).
// Nothing here reads a body: it works on headers and already-extracted field values.
import { PLATFORMS } from "@/lib/contracts/common";
import {
  MAX_DEPLOY_BODY_BYTES,
  MAX_JSON_BODY_BYTES,
  MAX_UPLOAD_BYTES,
} from "./limits";
import { archiveKindFromName, validateImage, validatePort, type ArchiveKind } from "./validators";

export interface Failure {
  ok: false;
  status: number;
  code: string;
}
const fail = (status: number, code: string): Failure => ({ ok: false, status, code });

export type BodyMode = "multipart" | "json";

/** Content-Type + Content-Length gate. A multipart upload MUST announce its length (no unbounded bodies). */
export function checkDeployHeaders(h: { contentType: string | null; contentLength: string | null }): { ok: true; mode: BodyMode } | Failure {
  const ct = (h.contentType ?? "").toLowerCase();
  const mode: BodyMode | null = ct.startsWith("multipart/form-data") ? "multipart" : ct.startsWith("application/json") ? "json" : null;
  if (!mode) return fail(415, "unsupported_media_type");
  if (h.contentLength === null || !/^\d{1,12}$/.test(h.contentLength.trim())) return fail(411, "length_required");
  const len = Number(h.contentLength);
  if (len > (mode === "multipart" ? MAX_DEPLOY_BODY_BYTES : MAX_JSON_BODY_BYTES)) return fail(413, "archive_too_large");
  return { ok: true, mode };
}

export type DeployInput =
  | { source: "archive"; archive: ArchiveKind; port: number; type: string; size: number }
  | { source: "image"; image: string; port: number; type: "docker" };

export interface RawDeployFields {
  source?: unknown;
  image?: unknown;
  port?: unknown;
  type?: unknown;
}
export interface FileMeta {
  name: string;
  size: number;
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");

/** Field validation: source kind, port, platform (archive) or image reference, file name/size. */
export function validateDeployFields(raw: RawDeployFields, file?: FileMeta): { ok: true; value: DeployInput } | Failure {
  const source = s(raw.source);
  const portText = s(raw.port).trim();
  if (validatePort(portText)) return fail(400, "bad_fields");
  const port = Number(portText);
  if (source === "image") {
    const image = s(raw.image).trim();
    if (validateImage(image)) return fail(400, "bad_fields");
    return { ok: true, value: { source: "image", image, port, type: "docker" } };
  }
  if (source !== "archive") return fail(400, "bad_fields");
  const type = s(raw.type);
  if (!(PLATFORMS as readonly string[]).includes(type)) return fail(400, "bad_fields");
  if (!file) return fail(400, "bad_fields");
  if (file.size <= 0) return fail(400, "archive_empty");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "archive_too_large");
  const archive = archiveKindFromName(file.name);
  if (!archive) return fail(400, "archive_type_mismatch");
  return { ok: true, value: { source: "archive", archive, port, type, size: file.size } };
}

/** Magic-byte sniffing: the name says .zip / .tar.gz, the bytes must agree. */
export function sniffArchive(bytes: Uint8Array): ArchiveKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06)) {
    return "zip";
  }
  if (bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) return "targz";
  return null;
}
