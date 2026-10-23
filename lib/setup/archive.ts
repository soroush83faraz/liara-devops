// Public entry point: open a zip or tar.gz held in memory and return a read-only view for the detector.
import { ArchiveError, Collector, type OpenOptions } from "./archive-core";
import { MAX_ARCHIVE_BYTES } from "./limits";
import { readTarGz } from "./tar";
import type { ProjectFiles } from "./types";
import { readZip } from "./zip";

export { ArchiveError, type ArchiveErrorCode, type OpenOptions } from "./archive-core";

export type ArchiveFormat = "zip" | "tgz";

export function detectArchiveFormat(bytes: Uint8Array): ArchiveFormat | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06)) return "zip";
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "tgz";
  return null;
}

export interface OpenedArchive extends ProjectFiles {
  format: ArchiveFormat;
}

export async function openArchive(bytes: Uint8Array, opts: OpenOptions): Promise<OpenedArchive> {
  const max = opts.limits?.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
  if (bytes.byteLength === 0) throw new ArchiveError("empty", "empty file");
  if (bytes.byteLength > max) throw new ArchiveError("too_large", "archive is too large");
  const format = detectArchiveFormat(bytes);
  if (!format) throw new ArchiveError("unsupported_format", "only .zip and .tar.gz archives are supported");
  const col = new Collector(opts, bytes.byteLength);
  if (format === "zip") readZip(bytes, col);
  else await readTarGz(bytes, col);
  const files = col.finish();
  if (files.paths.length === 0) throw new ArchiveError("empty", "archive has no files");
  return { ...files, format };
}
