// Strict streaming walker over a .tar.gz held in memory. Shared by the deploy scan (lib/create/tar-scan.ts) and
// the setup analyzer (lib/setup/tar.ts) so both enforce exactly the same rules. Nothing is extracted to disk.
//
// Rejected (an extractor could interpret these differently from us, or create something that is not a file):
//  - entry types other than regular files ('0', NUL, '7') and directories ('5'): hard/sym links ('1', '2'),
//    GNU long LINK names ('K'), devices, FIFOs, GNU sparse/dumpdir/multivolume/volume headers, vendor types;
//  - pax records that change what or where an entry is: linkpath, size, GNU.sparse.*, SCHILY.filetype,
//    SCHILY.realsize, SUN.*; `path` is honoured only in a LOCAL pax header ('x') and never in a GLOBAL one ('g')
//    (GNU tar applies a global path to every following entry); malformed or duplicate records; empty names;
//  - two name overrides for one entry (pax path + GNU long name, or two of either), metadata without an entry;
//  - anything but zero bytes after the first all-zero header block (entries hidden after the end-of-archive
//    marker are still extracted by readers that skip zero blocks);
//  - gzip framing problems: a second gzip member, trailing bytes, CRC/size mismatch, truncation (./gzip.ts).
// Each entry's EFFECTIVE name (pax path / GNU long name / ustar prefix + name) is handed to the caller, which owns
// path validation and its own limits. The running decompressed byte count is reported before each chunk is parsed
// so callers can enforce budgets, ratio guards and timeouts and abort early by throwing.
import { gunzipSingleMember, GzipFormatError } from "./gzip";

export type TarWalkFailure = "link" | "special_file" | "unsafe_metadata" | "bad_metadata" | "corrupt" | "truncated" | "trailing_data" | "multi_member" | "too_large";

export class TarWalkError extends Error {
  readonly code: TarWalkFailure;
  constructor(code: TarWalkFailure, message: string) {
    super(message);
    this.name = "TarWalkError";
    this.code = code;
  }
}

export interface TarEntry {
  /** Effective name, NOT normalised: the caller validates it (traversal, absolute paths, ...). */
  name: string;
  kind: "file" | "dir";
  /** Data size for files; 0 for directories. */
  size: number;
}

export interface TarWalkHandlers {
  /** Running decompressed byte count, before each chunk is parsed. Throw to abort (budget / ratio / timeout). */
  onProgress?(producedBytes: number): void;
  /** Every file and directory entry. Throw to reject the archive; return true to receive a file's bytes. */
  onEntry(entry: TarEntry): boolean | void;
  /** Bytes of an accepted file, in order (views into the decompressor's output; copy to keep). */
  onData?(chunk: Uint8Array): void;
  /** End of an accepted file's bytes. */
  onEntryEnd?(): void;
}

export interface TarWalkResult {
  producedBytes: number;
  entries: number;
}

const BLOCK = 512;
/** pax / GNU long-name payloads are names and small metadata, never file data. */
export const MAX_TAR_META_BYTES = 64 * 1024;
const ZEROS = Buffer.alloc(64 * 1024);
const DENIED_PAX_KEY = /^(?:linkpath|size|SCHILY\.filetype|SCHILY\.realsize|GNU\.sparse\..*|SUN\..*)$/;

type State =
  | { k: "header" }
  | { k: "data"; left: number; pad: number; capture: boolean }
  | { k: "meta"; type: "x" | "g" | "L"; left: number; pad: number; chunks: Buffer[] }
  | { k: "eof" };

function isZero(b: Buffer): boolean {
  for (let off = 0; off < b.length; off += ZEROS.length) {
    const n = Math.min(ZEROS.length, b.length - off);
    if (!b.subarray(off, off + n).equals(ZEROS.subarray(0, n))) return false;
  }
  return true;
}

/** Octal number field: optional leading spaces, octal digits, then only NUL/space padding (no hidden digits). */
function octal(h: Buffer, off: number, len: number): number {
  if (h[off] & 0x80) throw new TarWalkError("too_large", "base-256 tar numbers are not supported");
  const stop = off + len;
  let i = off;
  while (i < stop && h[i] === 0x20) i++;
  const start = i;
  while (i < stop && h[i] >= 0x30 && h[i] <= 0x37) i++;
  const digits = h.toString("latin1", start, i);
  for (; i < stop; i++) if (h[i] !== 0 && h[i] !== 0x20) throw new TarWalkError("corrupt", "corrupt tar header");
  return digits === "" ? 0 : Number.parseInt(digits, 8);
}

function cstr(h: Buffer, off: number, len: number): string {
  const end = h.indexOf(0, off);
  return h.toString("utf8", off, end === -1 || end > off + len ? off + len : end);
}

function checksumOk(h: Buffer): boolean {
  const stored = octal(h, 148, 8);
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const b = i >= 148 && i < 156 ? 0x20 : h[i];
    unsigned += b;
    signed += b > 127 ? b - 256 : b;
  }
  return stored === unsigned || stored === signed;
}

/** Strict pax record parser: "<len> <key>=<value>\n" with an exact length; duplicates are ambiguous. */
function parsePax(payload: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < payload.length) {
    const sp = payload.indexOf(0x20, i);
    if (sp < 0 || sp - i > 7) throw new TarWalkError("bad_metadata", "malformed pax header");
    const lenText = payload.toString("latin1", i, sp);
    if (!/^[1-9]\d{0,6}$/.test(lenText)) throw new TarWalkError("bad_metadata", "malformed pax header");
    const end = i + Number(lenText);
    if (end > payload.length || end <= sp + 2 || payload[end - 1] !== 0x0a) throw new TarWalkError("bad_metadata", "malformed pax header");
    const rec = payload.toString("utf8", sp + 1, end - 1);
    const eq = rec.indexOf("=");
    if (eq <= 0) throw new TarWalkError("bad_metadata", "malformed pax header");
    const key = rec.slice(0, eq);
    if (out.has(key)) throw new TarWalkError("unsafe_metadata", "duplicate pax record");
    out.set(key, rec.slice(eq + 1));
    i = end;
  }
  return out;
}

export async function walkTarGz(bytes: Uint8Array, h: TarWalkHandlers): Promise<TarWalkResult> {
  // `as State`: assignments happen inside the closures below, so the declaration must not narrow the type.
  let state = { k: "header" } as State;
  let header: Buffer = Buffer.alloc(0);
  let produced = 0;
  let entries = 0;
  // Metadata that applies to the next entry only.
  let pendingName: string | undefined;
  let seenLocalPax = false;
  let seenLongName = false;

  const setPendingName = (name: string) => {
    if (name === "" || name.includes("\0")) throw new TarWalkError("unsafe_metadata", "empty or invalid entry name override");
    if (pendingName !== undefined) throw new TarWalkError("unsafe_metadata", "conflicting entry name overrides");
    pendingName = name;
  };

  const finishMeta = (s: Extract<State, { k: "meta" }>) => {
    const payload = Buffer.concat(s.chunks);
    if (s.type === "L") {
      const nul = payload.indexOf(0);
      setPendingName(payload.toString("utf8", 0, nul === -1 ? payload.length : nul));
      return;
    }
    const records = parsePax(payload);
    for (const [key, value] of records) {
      if (DENIED_PAX_KEY.test(key)) throw new TarWalkError("unsafe_metadata", `pax record ${JSON.stringify(key.slice(0, 40))} is not allowed`);
      if (key === "path") {
        if (s.type === "g") throw new TarWalkError("unsafe_metadata", "a global pax header may not set a path");
        setPendingName(value);
      }
    }
  };

  const onHeader = (blk: Buffer) => {
    if (isZero(blk)) {
      if (pendingName !== undefined || seenLocalPax || seenLongName) throw new TarWalkError("bad_metadata", "metadata without an entry");
      state = { k: "eof" };
      return;
    }
    if (!checksumOk(blk)) throw new TarWalkError("corrupt", "corrupt tar header");
    const type = blk[156] === 0 ? "0" : String.fromCharCode(blk[156]);
    const size = octal(blk, 124, 12);
    const pad = (BLOCK - (size % BLOCK)) % BLOCK;

    if (type === "x" || type === "g" || type === "L") {
      if (size > MAX_TAR_META_BYTES) throw new TarWalkError("bad_metadata", "tar metadata too large");
      if (type === "x") {
        if (seenLocalPax) throw new TarWalkError("unsafe_metadata", "two pax headers for one entry");
        seenLocalPax = true;
      } else if (type === "L") {
        if (seenLongName) throw new TarWalkError("unsafe_metadata", "two long-name headers for one entry");
        seenLongName = true;
      } else if (pendingName !== undefined || seenLocalPax || seenLongName) {
        throw new TarWalkError("unsafe_metadata", "global pax header between an entry's metadata and the entry");
      }
      const meta: Extract<State, { k: "meta" }> = { k: "meta", type, left: size, pad, chunks: [] };
      state = meta;
      if (size === 0) {
        finishMeta(meta);
        state = { k: "header" };
      }
      return;
    }
    if (type === "1" || type === "2" || type === "K") throw new TarWalkError("link", "links are not allowed");
    if (type !== "0" && type !== "7" && type !== "5") throw new TarWalkError("special_file", "only regular files and directories are allowed");

    // POSIX ustar ("ustar\0") carries a name prefix at 345; the GNU magic ("ustar  ") puts other fields there.
    const posix = blk.toString("latin1", 257, 263) === "ustar\0";
    const base = cstr(blk, 0, 100);
    const prefix = posix ? cstr(blk, 345, 155) : "";
    const name = pendingName ?? (prefix ? `${prefix}/${base}` : base);
    pendingName = undefined;
    seenLocalPax = false;
    seenLongName = false;
    if (name === "") throw new TarWalkError("corrupt", "tar entry without a name");
    const isDir = type === "5" || name.endsWith("/");
    if (isDir && type !== "5" && size > 0) throw new TarWalkError("corrupt", "directory entry with data");
    entries++;
    const capture = h.onEntry({ name, kind: isDir ? "dir" : "file", size: isDir ? 0 : size }) === true && !isDir;
    state = { k: "data", left: size, pad, capture };
    if (size === 0) {
      if (capture) h.onEntryEnd?.();
      if (pad === 0) state = { k: "header" };
    }
  };

  const push = (chunk: Buffer) => {
    let off = 0;
    while (off < chunk.length) {
      const s = state;
      if (s.k === "eof") {
        if (!isZero(chunk.subarray(off))) throw new TarWalkError("trailing_data", "data after the end-of-archive marker");
        return;
      }
      if (s.k === "header") {
        const take = Math.min(BLOCK - header.length, chunk.length - off);
        header = header.length === 0 && take === BLOCK ? chunk.subarray(off, off + take) : Buffer.concat([header, chunk.subarray(off, off + take)]);
        off += take;
        if (header.length === BLOCK) {
          const blk = header;
          header = Buffer.alloc(0);
          onHeader(blk);
        }
        continue;
      }
      if (s.left > 0) {
        const n = Math.min(s.left, chunk.length - off);
        if (s.k === "meta") s.chunks.push(Buffer.from(chunk.subarray(off, off + n)));
        else if (s.capture) h.onData?.(chunk.subarray(off, off + n));
        s.left -= n;
        off += n;
        if (s.left === 0) {
          if (s.k === "meta") finishMeta(s);
          else if (s.capture) h.onEntryEnd?.();
        }
      }
      if (s.left === 0) {
        const n = Math.min(s.pad, chunk.length - off);
        s.pad -= n;
        off += n;
        if (s.pad === 0) state = { k: "header" };
      }
    }
  };

  try {
    await gunzipSingleMember(bytes, (chunk) => {
      produced += chunk.length;
      h.onProgress?.(produced);
      push(chunk);
    });
  } catch (e) {
    if (e instanceof GzipFormatError) {
      const code: TarWalkFailure = e.reason === "multi_member" ? "multi_member" : e.reason === "trailing_data" ? "trailing_data" : e.reason === "truncated" ? "truncated" : "corrupt";
      throw new TarWalkError(code, `invalid gzip stream (${e.reason})`);
    }
    throw e;
  }
  if (state.k === "data" || state.k === "meta" || header.length > 0) throw new TarWalkError("truncated", "truncated tar archive");
  if (pendingName !== undefined || seenLocalPax || seenLongName) throw new TarWalkError("bad_metadata", "metadata without an entry");
  return { producedBytes: produced, entries };
}
