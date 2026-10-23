// Safety scan for a user-supplied .tar.gz that we forward unchanged to Liara's builder. Runs the strict walker of
// lib/archive/tar-walk.ts (one gzip member, regular files and directories only, no links/devices/FIFOs, no path or
// size overrides in pax/GNU metadata, nothing but zeros after the end-of-archive marker) and enforces the same
// zip-bomb bounds as the zip repacker: a budget on the bytes the decompressor ACTUALLY produces (headers can lie),
// a whole-archive compression-ratio guard and an entry-count cap. The data is never extracted to disk.
import { isImplausibleSourceRatio, safeEntryPath, SourceArchiveError } from "@/lib/liara";
import { TarWalkError, walkTarGz, type TarWalkFailure } from "@/lib/archive/tar-walk";
import { MAX_ARCHIVE_FILES, MAX_TAR_UNCOMPRESSED_BYTES } from "./limits";

export interface TarScanOptions {
  maxUncompressedBytes?: number;
  maxFiles?: number;
}

const FAILURE: Record<TarWalkFailure, SourceArchiveError["code"]> = {
  link: "symlink",
  special_file: "unsafe_path",
  unsafe_metadata: "unsafe_path",
  bad_metadata: "invalid_zip",
  corrupt: "invalid_zip",
  truncated: "invalid_zip",
  trailing_data: "invalid_zip",
  multi_member: "invalid_zip",
  too_large: "too_large",
};

export async function scanTarGz(data: Uint8Array, opts: TarScanOptions = {}): Promise<{ files: number; uncompressedBytes: number }> {
  const { maxUncompressedBytes = MAX_TAR_UNCOMPRESSED_BYTES, maxFiles = MAX_ARCHIVE_FILES } = opts;
  let files = 0;
  let declared = 0;
  try {
    await walkTarGz(data, {
      onProgress(produced) {
        if (produced > maxUncompressedBytes) throw new SourceArchiveError("too_large", "Archive content is too large when uncompressed");
        if (isImplausibleSourceRatio(produced, data.byteLength)) throw new SourceArchiveError("too_large", "Archive compression ratio is implausible");
      },
      onEntry(entry) {
        const path = safeEntryPath(entry.name);
        if (entry.kind === "file" && path) {
          if (++files > maxFiles) throw new SourceArchiveError("too_many_files", "Too many files in archive");
          declared += entry.size;
          if (declared > maxUncompressedBytes) throw new SourceArchiveError("too_large", "Archive content is too large when uncompressed");
        }
        return false;
      },
    });
  } catch (e) {
    if (e instanceof SourceArchiveError) throw e;
    if (e instanceof TarWalkError) throw new SourceArchiveError(FAILURE[e.code], "Could not read the archive safely");
    throw new SourceArchiveError("invalid_zip", "Could not read the archive");
  }
  if (files === 0) throw new SourceArchiveError("empty", "No files in archive");
  return { files, uncompressedBytes: declared };
}
