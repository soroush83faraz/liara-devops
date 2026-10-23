// Strict single-member gzip decompression with native zlib. Untrusted .tar.gz input is decompressed exactly ONCE,
// as a stream: every output chunk is handed to the caller (which counts it against its byte budget and parses it)
// and then dropped, so memory stays at one chunk whatever the archive expands to.
//
// Strict framing (RFC 1952), because different gunzip implementations disagree on the edge cases and a difference
// is a smuggling channel (we validate one view, the builder extracts another):
//  - exactly one member: Node's Gunzip silently continues into a concatenated second member, GNU gzip warns and
//    stops at garbage, Go errors. We parse the member header ourselves, inflate the raw deflate body, read the
//    consumed input length from the engine, and require the 8-byte trailer to be the LAST bytes of the file.
//  - the trailer CRC32 and ISIZE must match what was produced; reserved header flags must be clear.
import { createInflateRaw, crc32 } from "node:zlib";

export type GzipFailure = "not_gzip" | "corrupt" | "truncated" | "checksum" | "multi_member" | "trailing_data";

export class GzipFormatError extends Error {
  readonly reason: GzipFailure;
  constructor(reason: GzipFailure) {
    super(`invalid gzip data (${reason})`);
    this.name = "GzipFormatError";
    this.reason = reason;
  }
}

const FLG_RESERVED = 0xe0;
const FHCRC = 0x02;
const FEXTRA = 0x04;
const FNAME = 0x08;
const FCOMMENT = 0x10;
/** Bound for the optional FNAME / FCOMMENT header fields (they are NUL-terminated and otherwise unbounded). */
const MAX_HEADER_FIELD = 64 * 1024;

/** Length of the gzip member header starting at 0. Throws GzipFormatError. */
export function gzipHeaderLength(b: Uint8Array): number {
  if (b.byteLength < 2 || b[0] !== 0x1f || b[1] !== 0x8b) throw new GzipFormatError("not_gzip");
  if (b.byteLength < 10) throw new GzipFormatError("truncated");
  if (b[2] !== 8) throw new GzipFormatError("corrupt");
  const flags = b[3];
  if (flags & FLG_RESERVED) throw new GzipFormatError("corrupt");
  let pos = 10;
  if (flags & FEXTRA) {
    if (pos + 2 > b.byteLength) throw new GzipFormatError("truncated");
    pos += 2 + (b[pos] | (b[pos + 1] << 8));
  }
  for (const field of [FNAME, FCOMMENT]) {
    if (!(flags & field)) continue;
    const end = b.indexOf(0, pos);
    if (end < 0 || end - pos > MAX_HEADER_FIELD) throw new GzipFormatError("corrupt");
    pos = end + 1;
  }
  if (flags & FHCRC) pos += 2;
  if (pos > b.byteLength) throw new GzipFormatError("truncated");
  return pos;
}

/**
 * Decompresses a single-member gzip file, streaming each output chunk to `onChunk`. If `onChunk` throws, the
 * engine is destroyed immediately and that error is rethrown (callers enforce byte budgets this way and abort
 * early). Resolves with the total number of decompressed bytes. Throws GzipFormatError for any framing problem.
 */
export async function gunzipSingleMember(bytes: Uint8Array, onChunk: (chunk: Buffer) => void): Promise<number> {
  const start = gzipHeaderLength(bytes);
  const body = Buffer.from(bytes.buffer, bytes.byteOffset + start, bytes.byteLength - start); // a view, no copy
  const inflater = createInflateRaw({ chunkSize: 64 * 1024 });
  let total = 0;
  let crc = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      inflater.destroy();
      reject(e);
    };
    inflater.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      crc = crc32(chunk, crc);
      try {
        onChunk(chunk);
      } catch (e) {
        fail(e);
      }
    });
    inflater.on("error", (e: NodeJS.ErrnoException) => fail(new GzipFormatError(e.code === "Z_BUF_ERROR" ? "truncated" : "corrupt")));
    inflater.on("end", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    inflater.end(body);
  });
  // `bytesWritten` is the input the engine actually consumed: the deflate stream ends exactly there.
  const trailer = start + inflater.bytesWritten;
  if (trailer + 8 > bytes.byteLength) throw new GzipFormatError("truncated");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(trailer, true) !== crc >>> 0 || dv.getUint32(trailer + 4, true) !== total % 0x1_0000_0000) {
    throw new GzipFormatError("checksum");
  }
  const rest = bytes.byteLength - (trailer + 8);
  if (rest > 0) throw new GzipFormatError(rest >= 2 && bytes[trailer + 8] === 0x1f && bytes[trailer + 9] === 0x8b ? "multi_member" : "trailing_data");
  return total;
}
