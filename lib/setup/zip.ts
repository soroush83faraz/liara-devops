// Minimal, defensive ZIP reader: parses the central directory itself, never extracts to disk, and only
// inflates entries the collector asked for (each capped at the declared size).
import { inflateRawSync } from "node:zlib";
import { ArchiveError, type Collector } from "./archive-core";

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function readZip(bytes: Uint8Array, col: Collector): void {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ArchiveError("invalid_archive", "not a valid zip file");
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  let pos = dv.getUint32(eocd + 16, true);
  if (total === 0xffff || pos === 0xffffffff || cdSize === 0xffffffff) {
    throw new ArchiveError("invalid_archive", "zip64 archives are not supported");
  }
  if (pos + cdSize > len) throw new ArchiveError("invalid_archive", "corrupt zip directory");
  if (total > col.limits.maxRawEntries) throw new ArchiveError("too_many_entries", "too many entries");

  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < total; n++) {
    if (pos + 46 > len || dv.getUint32(pos, true) !== CD_SIG) throw new ArchiveError("invalid_archive", "corrupt zip directory");
    const hostOs = dv.getUint16(pos + 4, true) >> 8;
    const flags = dv.getUint16(pos + 8, true);
    const method = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const size = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const mode = dv.getUint32(pos + 38, true) >>> 16;
    const localOffset = dv.getUint32(pos + 42, true);
    if (pos + 46 + nameLen > len) throw new ArchiveError("invalid_archive", "corrupt zip directory");
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (hostOs === 3 && (mode & S_IFMT) === S_IFLNK) throw new ArchiveError("symlink", "symlinks are not allowed");
    if (flags & 1) throw new ArchiveError("encrypted", "encrypted zip entries are not supported");
    const isDir = name.endsWith("/");
    const wanted = col.consider(name, size, isDir ? "dir" : "file", isDir ? undefined : compSize);
    if (!wanted || isDir) continue;
    if (method !== 0 && method !== 8) continue;

    if (localOffset + 30 > len || dv.getUint32(localOffset, true) !== LOCAL_SIG) throw new ArchiveError("invalid_archive", "corrupt zip entry");
    const dataStart = localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
    if (dataStart + compSize > len) throw new ArchiveError("invalid_archive", "corrupt zip entry");
    const slice = bytes.subarray(dataStart, dataStart + compSize);
    let out: Uint8Array;
    if (method === 0) {
      if (compSize !== size) throw new ArchiveError("invalid_archive", "corrupt zip entry");
      out = slice;
    } else {
      try {
        // maxOutputLength makes a header that under-declares the real size fail instead of ballooning.
        out = inflateRawSync(slice, { maxOutputLength: Math.max(1, size) });
      } catch {
        throw new ArchiveError("bomb", "zip entry does not match its declared size");
      }
      if (out.byteLength !== size) throw new ArchiveError("invalid_archive", "zip entry size mismatch");
    }
    col.store(name, out);
  }
}
