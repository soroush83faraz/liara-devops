// Shared bookkeeping for the zip and tar.gz readers: path safety, ignore rules, every hard limit, retention of
// the few small files the detector wants. Nothing is ever written to disk and nothing is executed.
import {
  DEFAULT_LIMITS,
  IGNORED_DIRS,
  MAX_ENTRY_RATIO,
  MAX_PATH_LENGTH,
  MAX_RATIO,
  MAX_RATIO_TRIGGER_BYTES,
  type ArchiveLimits,
} from "./limits";
import type { ProjectFiles } from "./types";

export type ArchiveErrorCode =
  | "empty"
  | "unsupported_format"
  | "invalid_archive"
  | "unsafe_path"
  | "symlink"
  | "encrypted"
  | "too_large"
  | "too_many_entries"
  | "too_deep"
  | "bomb"
  | "timeout";

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  constructor(code: ArchiveErrorCode, message: string) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
  }
}

export interface OpenOptions {
  /** Which files the detector wants to read (relative to the project root; the collector also tries it without the top folder). */
  wants: (path: string) => boolean;
  /** Applied to a retained file's text immediately (used to reduce .env files to names). */
  transform?: (path: string, text: string) => string;
  limits?: Partial<ArchiveLimits>;
  now?: () => number;
}

/** Normalises an entry path. Rejects absolute paths, drive letters, NUL, backslash tricks and `..`. Returns "" for `.`/empty. */
export function normalizeEntryPath(raw: string): string {
  const bad = () => new ArchiveError("unsafe_path", "unsafe path in archive");
  if (raw.length > MAX_PATH_LENGTH || raw.includes("\0")) throw bad();
  const p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) throw bad();
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.includes("..")) throw bad();
  return parts.join("/");
}

export function isIgnoredPath(path: string): boolean {
  return path.split("/").some((seg) => IGNORED_DIRS.has(seg));
}

const stripFirst = (p: string) => p.slice(p.indexOf("/") + 1);

export class Collector {
  readonly limits: ArchiveLimits;
  private readonly deadline: number;
  private readonly now: () => number;
  private raw = 0;
  private counted = 0;
  private declared = 0;
  private ignored = 0;
  private skippedLarge = 0;
  private retainedBytes = 0;
  private totalBytes = 0;
  private readonly paths: string[] = [];
  private readonly content = new Map<string, string>();

  constructor(
    private readonly opts: OpenOptions,
    private readonly archiveBytes: number,
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.now = opts.now ?? Date.now;
    this.deadline = this.now() + this.limits.maxParseMs;
  }

  tick(): void {
    if (this.now() > this.deadline) throw new ArchiveError("timeout", "archive analysis timed out");
  }

  /** Budget + ratio check for bytes actually produced by a decompressor (tar.gz stream). */
  addStreamed(total: number): void {
    if (total > this.limits.maxUncompressedBytes) throw new ArchiveError("too_large", "archive is too large when uncompressed");
    if (total > MAX_RATIO_TRIGGER_BYTES && total / Math.max(1, this.archiveBytes) > MAX_RATIO) {
      throw new ArchiveError("bomb", "compression ratio is implausible");
    }
    this.tick();
  }

  /**
   * Registers an entry from the archive's directory/headers. Throws on any violation. Returns true when the
   * caller should hand over the file's bytes via `store()`.
   */
  consider(rawPath: string, size: number, kind: "file" | "dir", compressedSize?: number): boolean {
    const path = normalizeEntryPath(rawPath);
    if (path === "") return false;
    if (++this.raw > this.limits.maxRawEntries) throw new ArchiveError("too_many_entries", "too many entries");
    this.declared += size;
    if (this.declared > this.limits.maxUncompressedBytes) throw new ArchiveError("too_large", "archive is too large when uncompressed");
    if (compressedSize !== undefined && size > 1024 * 1024 && size / Math.max(1, compressedSize) > MAX_ENTRY_RATIO) {
      throw new ArchiveError("bomb", "entry compression ratio is implausible");
    }
    if (this.declared > MAX_RATIO_TRIGGER_BYTES && this.declared / Math.max(1, this.archiveBytes) > MAX_RATIO) {
      throw new ArchiveError("bomb", "compression ratio is implausible");
    }
    if (this.raw % 512 === 0) this.tick();
    if (isIgnoredPath(path)) {
      this.ignored++;
      return false;
    }
    if (path.split("/").length > this.limits.maxDepth) throw new ArchiveError("too_deep", "path is too deep");
    if (kind === "dir") return false;
    if (++this.counted > this.limits.maxCountedEntries) throw new ArchiveError("too_many_entries", "too many files");
    this.paths.push(path);
    this.totalBytes += size;
    if (!(this.opts.wants(path) || (path.includes("/") && this.opts.wants(stripFirst(path))))) return false;
    if (size > this.limits.maxInspectedFileBytes) {
      this.skippedLarge++;
      return false;
    }
    if (this.content.size >= this.limits.maxRetainedFiles || this.retainedBytes + size > this.limits.maxRetainedBytes) return false;
    this.retainedBytes += size;
    return true;
  }

  /** Called with the decompressed bytes of a file `consider()` accepted. */
  store(rawPath: string, bytes: Uint8Array): void {
    const path = normalizeEntryPath(rawPath);
    if (bytes.byteLength > this.limits.maxInspectedFileBytes) return;
    const probe = bytes.subarray(0, 8192);
    if (probe.includes(0)) return; // binary
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    this.content.set(path, this.opts.transform ? this.opts.transform(path, text) : text);
  }

  finish(): ProjectFiles {
    let prefix = "";
    if (this.paths.length > 0 && this.paths.every((p) => p.includes("/"))) {
      const first = this.paths[0].slice(0, this.paths[0].indexOf("/") + 1);
      if (this.paths.every((p) => p.startsWith(first))) prefix = first;
    }
    const paths = prefix ? this.paths.map((p) => p.slice(prefix.length)) : [...this.paths];
    const content = this.content;
    return {
      paths,
      totalBytes: this.totalBytes,
      skippedLarge: this.skippedLarge,
      read: (p: string) => content.get(prefix + p) ?? (prefix ? undefined : content.get(p)),
    };
  }
}
