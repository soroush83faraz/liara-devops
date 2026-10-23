// Streaming tar.gz reader for the setup analyzer. Uses the same strict walker as the deploy scan
// (lib/archive/tar-walk.ts): one gzip member, regular files and directories only (links, devices, FIFOs and other
// special entries are rejected), no path/size overrides in pax or GNU metadata, nothing but zeros after the
// end-of-archive marker. Every decompressed byte is counted against the collector's budget and ratio guard before
// it is parsed, and only the bytes of files the collector accepted are kept.
import { TarWalkError, walkTarGz, type TarWalkFailure } from "@/lib/archive/tar-walk";
import { ArchiveError, type ArchiveErrorCode, type Collector } from "./archive-core";

const FAILURE: Record<TarWalkFailure, ArchiveErrorCode> = {
  link: "symlink",
  special_file: "unsafe_path",
  unsafe_metadata: "unsafe_path",
  bad_metadata: "invalid_archive",
  corrupt: "invalid_archive",
  truncated: "invalid_archive",
  trailing_data: "invalid_archive",
  multi_member: "invalid_archive",
  too_large: "too_large",
};

export async function readTarGz(bytes: Uint8Array, col: Collector): Promise<void> {
  let capture: { path: string; chunks: Buffer[] } | null = null;
  let sawEntry = false;
  try {
    await walkTarGz(bytes, {
      onProgress: (produced) => col.addStreamed(produced),
      onEntry(entry) {
        sawEntry = true;
        const accept = col.consider(entry.name, entry.size, entry.kind);
        if (accept && entry.kind === "file") {
          capture = { path: entry.name, chunks: [] };
          return true;
        }
        return false;
      },
      onData(chunk) {
        capture?.chunks.push(Buffer.from(chunk));
      },
      onEntryEnd() {
        if (capture) col.store(capture.path, Buffer.concat(capture.chunks));
        capture = null;
      },
    });
  } catch (e) {
    if (e instanceof ArchiveError) throw e;
    if (e instanceof TarWalkError) throw new ArchiveError(FAILURE[e.code], "could not read the tar.gz file safely");
    throw new ArchiveError("invalid_archive", "could not read the tar.gz file");
  }
  if (!sawEntry) throw new ArchiveError("empty", "archive has no files");
}
