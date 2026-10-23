import { pipeline } from "node:stream/promises";
import { createGzip, createInflateRaw, inflateRawSync } from "node:zlib";
import * as tar from "tar-stream";
import { invalidArgument, isLiaraError, type LiaraClient } from "./core";
import { getApp, type AppPlatform } from "./apps";
import { buildLineKey, getBuildLogs } from "./logs";
import { getRelease } from "./releases";
import { createIgnore, DEFAULT_IGNORES } from "./ignore";
import { CreatedReleaseSchema, SourceUploadSchema, type Release } from "./schemas";
import { seg, sleep } from "./util";

/** [CLI] constants.ts MAX_SOURCE_SIZE: compressed archive limit. */
export const MAX_SOURCE_SIZE = 256 * 1024 * 1024;

/*
 * Zip-bomb bounds for every source archive we unpack (the zip we repack) or forward (the tar.gz we scan, see
 * lib/create/tar-scan.ts). Declared sizes are checked BEFORE anything is inflated, and the bytes a decompressor
 * actually produces are counted while streaming, because headers lie.
 */
export const MAX_SOURCE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
export const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_SOURCE_FILES = 50_000;
/** Above this many uncompressed bytes, uncompressed/compressed may not exceed MAX_SOURCE_RATIO. */
export const SOURCE_RATIO_TRIGGER_BYTES = 64 * 1024 * 1024;
export const MAX_SOURCE_RATIO = 100;
/** deflate cannot exceed ~1032:1, so a > 1 MiB entry declaring more than this is lying about its size. */
const MAX_ENTRY_RATIO = 1100;
/** Root ignore files are read into memory to evaluate them; a larger one is refused (never silently skipped). */
const MAX_IGNORE_FILE_BYTES = 1024 * 1024;
/** Slice size when streaming in-memory bytes into the tar (keeps every buffer in flight small). */
const WRITE_SLICE = 256 * 1024;

/** Whole-archive compression-ratio guard shared by the zip repacker and the tar.gz scan. */
export function isImplausibleSourceRatio(uncompressedBytes: number, compressedBytes: number): boolean {
  return uncompressedBytes > SOURCE_RATIO_TRIGGER_BYTES && uncompressedBytes / Math.max(1, compressedBytes) > MAX_SOURCE_RATIO;
}

// ---- Archive ---------------------------------------------------------------

export type SourceArchiveErrorCode = "unsafe_path" | "symlink" | "too_large" | "too_many_files" | "empty" | "invalid_zip";
export class SourceArchiveError extends Error {
  readonly code: SourceArchiveErrorCode;
  constructor(code: SourceArchiveErrorCode, message: string) {
    super(message);
    this.name = "SourceArchiveError";
    this.code = code;
  }
}

export interface SourceFile {
  /** Relative posix path inside the project. */
  path: string;
  data: Uint8Array | string;
  /** Unix mode bits; a symlink mode is rejected. */
  mode?: number;
}
export type SourceInput = { files: ReadonlyArray<SourceFile> } | { zip: Uint8Array };

export interface ArchiveOptions {
  /** Compressed limit (default 256 MiB). */
  maxBytes?: number;
  /** Total uncompressed limit, zip-bomb guard (default MAX_SOURCE_UNCOMPRESSED_BYTES = 256 MiB). */
  maxUncompressedBytes?: number;
  /** Per-file uncompressed limit (default MAX_SOURCE_FILE_BYTES = 100 MiB). */
  maxFileBytes?: number;
  maxFiles?: number;
  /** Apply default ignores + .liaraignore/.dockerignore/.gitignore (default true). */
  applyIgnore?: boolean;
  /** Zip input: drop the single top-level folder most zip tools add (default true). */
  stripSingleRoot?: boolean;
}
export interface SourceArchive {
  data: Buffer;
  size: number;
  fileCount: number;
  ignoredCount: number;
  uncompressedBytes: number;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Normalises an archive entry path; throws on absolute paths, drive letters, NUL and `..`. Returns "" for directory markers. */
export function safeEntryPath(raw: string): string {
  const p = raw.replace(/\\/g, "/");
  if (p.includes("\0") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) {
    throw new SourceArchiveError("unsafe_path", `Unsafe path in archive: ${JSON.stringify(raw.slice(0, 80))}`);
  }
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.includes("..")) throw new SourceArchiveError("unsafe_path", `Path traversal in archive: ${JSON.stringify(raw.slice(0, 80))}`);
  return parts.join("/");
}

/** One file to put in the tar: in-memory bytes, or a raw-deflate slice of the zip that is inflated while streaming. */
interface PlannedFile {
  path: string;
  /** Uncompressed size (declared by the zip central directory; exact for in-memory data). */
  size: number;
  mode: number;
  /** Bytes this entry occupies in the archive (= size for in-memory and stored entries). */
  compressedSize: number;
  data: Uint8Array;
  deflated: boolean;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const invalidZip = (message: string) => new SourceArchiveError("invalid_zip", message);

/**
 * Lists a zip from its central directory WITHOUT inflating anything. Rejects Zip64, multi-volume, encrypted entries,
 * symlinks, unsupported compression, entries whose data lies outside the archive body or overlaps another entry
 * (overlap bombs reference one compressed kernel many times), unsafe paths and too many files.
 */
function listZip(zip: Uint8Array, maxFiles: number): PlannedFile[] {
  const len = zip.byteLength;
  if (len < 22) throw invalidZip("Not a valid zip file");
  const dv = new DataView(zip.buffer, zip.byteOffset, len);
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalidZip("Not a valid zip file");
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw invalidZip("Zip64 archives are not supported");
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0 || dv.getUint16(eocd + 8, true) !== total) {
    throw invalidZip("Multi-volume zip archives are not supported");
  }
  const cdEnd = cdOffset + cdSize;
  if (cdEnd > eocd) throw invalidZip("Corrupt zip directory");

  const out: PlannedFile[] = [];
  const spans: Array<[number, number]> = [];
  let files = 0;
  let pos = cdOffset;
  for (let n = 0; n < total; n++) {
    if (pos + 46 > cdEnd || dv.getUint32(pos, true) !== CD_SIG) throw invalidZip("Corrupt zip directory");
    const hostOs = dv.getUint16(pos + 4, true) >> 8;
    const flags = dv.getUint16(pos + 8, true);
    const method = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const size = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const mode = dv.getUint32(pos + 38, true) >>> 16;
    const localOffset = dv.getUint32(pos + 42, true);
    const next = pos + 46 + nameLen + dv.getUint16(pos + 30, true) + dv.getUint16(pos + 32, true);
    if (next > cdEnd) throw invalidZip("Corrupt zip directory");
    const nameBytes = Buffer.from(zip.buffer, zip.byteOffset + pos + 46, nameLen);
    // Same decoding fflate used: UTF-8 when the language-encoding flag is set, else latin1.
    const name = flags & 0x800 ? nameBytes.toString("utf8") : nameBytes.toString("latin1");
    pos = next;

    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw invalidZip("Zip64 archives are not supported");
    if (hostOs === 3 && (mode & S_IFMT) === S_IFLNK) throw new SourceArchiveError("symlink", `Symlinks are not allowed: ${JSON.stringify(name.slice(0, 80))}`);
    if (flags & 0x1) throw invalidZip("Encrypted zip entries are not supported");
    if (localOffset + 30 > cdOffset || dv.getUint32(localOffset, true) !== LOCAL_SIG) throw invalidZip("Corrupt zip entry");
    const dataStart = localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
    const dataEnd = dataStart + compSize;
    if (dataEnd > cdOffset) throw invalidZip("Corrupt zip entry");
    spans.push([localOffset, dataEnd]);

    const isDir = name.endsWith("/") || name.endsWith("\\");
    const path = safeEntryPath(name);
    if (isDir || !path) continue;
    if (method !== 0 && method !== 8) throw invalidZip("Unsupported zip compression method");
    if (method === 0 && compSize !== size) throw invalidZip("Corrupt zip entry");
    if (++files > maxFiles) throw new SourceArchiveError("too_many_files", "Too many files in archive");
    out.push({ path, size, mode: 0o644, compressedSize: compSize, data: zip.subarray(dataStart, dataEnd), deflated: method === 8 });
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] < spans[i - 1][1]) throw new SourceArchiveError("too_large", "Overlapping zip entries (zip bomb)");
  }
  return out;
}

/** Inflates a SMALL entry fully (root ignore files only); output can never exceed the declared size. */
function readSmall(f: PlannedFile): Uint8Array {
  if (f.size > MAX_IGNORE_FILE_BYTES) throw new SourceArchiveError("too_large", `${f.path} is too large to evaluate`);
  if (!f.deflated) return f.data;
  let out: Buffer;
  try {
    out = inflateRawSync(f.data, { maxOutputLength: Math.max(1, f.size) });
  } catch (e) {
    if (e instanceof RangeError) throw new SourceArchiveError("too_large", "A zip entry is larger than its header declares");
    throw invalidZip("Could not read the zip file");
  }
  if (out.byteLength !== f.size) throw invalidZip("Zip entry size mismatch");
  return out;
}

class EntryClosedError extends Error {
  constructor() {
    super("tar entry closed");
    this.name = "EntryClosedError";
  }
}

/** The part of a tar-stream entry (a streamx Writable) used here; `destroying` is set as soon as destroy() starts. */
interface EntrySink {
  write(chunk: Uint8Array): boolean;
  end(): unknown;
  destroy(err?: Error): unknown;
  readonly destroyed: boolean;
  readonly destroying?: boolean;
  on(event: "drain" | "close" | "error", listener: () => void): unknown;
  off(event: "drain" | "close", listener: () => void): unknown;
}

const ignoreError = () => undefined;

/** Writes one chunk, waiting for the tar stream to drain (end-to-end backpressure: nothing piles up in memory). */
function writeChunk(sink: EntrySink, chunk: Uint8Array): Promise<void> {
  if (sink.destroying === true || sink.destroyed) return Promise.reject(new EntryClosedError());
  if (sink.write(chunk)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      sink.off("drain", onDrain);
      sink.off("close", onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new EntryClosedError());
    };
    sink.on("drain", onDrain);
    sink.on("close", onClose);
  });
}

/** Streams one file into its tar entry; a deflated entry is inflated chunk by chunk and capped at its declared size. */
async function fillEntry(sink: EntrySink, f: PlannedFile): Promise<void> {
  if (!f.deflated) {
    for (let off = 0; off < f.data.byteLength; off += WRITE_SLICE) {
      await writeChunk(sink, f.data.subarray(off, Math.min(f.data.byteLength, off + WRITE_SLICE)));
    }
  } else {
    const inflater = createInflateRaw({ chunkSize: 64 * 1024 });
    inflater.end(f.data);
    let produced = 0;
    try {
      for await (const chunk of inflater as AsyncIterable<Buffer>) {
        produced += chunk.length;
        // Headers lie: the declared size (already checked against every budget) is the hard cap.
        if (produced > f.size) throw new SourceArchiveError("too_large", "A zip entry is larger than its header declares");
        await writeChunk(sink, chunk);
      }
    } catch (e) {
      inflater.destroy();
      if (e instanceof SourceArchiveError || e instanceof EntryClosedError) throw e;
      throw invalidZip("Could not read the zip file");
    }
    if (produced !== f.size) throw invalidZip("Zip entry size mismatch");
  }
  sink.end();
}

function writeEntry(pack: tar.Pack, f: PlannedFile): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sink = pack.entry({ name: f.path, size: f.size, mode: f.mode, mtime: new Date(0) }, (err) => (err ? reject(err) : resolve())) as unknown as EntrySink;
    // Failures travel through the promises; without a listener a destroyed entry's 'error' event would be uncaught.
    sink.on("error", ignoreError);
    fillEntry(sink, f).catch((e: unknown) => {
      reject(e);
      sink.destroy(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

async function* tarChunks(pack: tar.Pack): AsyncGenerator<Buffer> {
  for await (const chunk of pack) yield chunk as Buffer;
}

/**
 * zip/files -> tar (tar-stream) -> gzip (zlib), fully streamed: at any time only the current chunk of one entry,
 * the tar/gzip stream buffers and the compressed output (capped at `maxBytes`) are in memory.
 */
async function packTarGz(files: Iterable<PlannedFile>, maxBytes: number): Promise<Buffer> {
  const pack = tar.pack();
  pack.on("error", ignoreError); // reported through `writer` / `piping` below
  const out: Buffer[] = [];
  let outBytes = 0;
  const writer = (async () => {
    try {
      for (const f of files) await writeEntry(pack, f);
      pack.finalize();
    } catch (e) {
      pack.destroy(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  })();
  const piping = pipeline(tarChunks(pack), createGzip({ level: 9 }), async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) {
      outBytes += chunk.length;
      if (outBytes > maxBytes) throw new SourceArchiveError("too_large", `Compressed source exceeds the limit of ${maxBytes} bytes`);
      out.push(chunk);
    }
  });
  const settled = await Promise.allSettled([piping, writer]);
  const errors = settled.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
  if (errors.length > 0) throw errors.find((e) => e instanceof SourceArchiveError) ?? errors[0];
  return Buffer.concat(out, outBytes);
}

/**
 * Builds the `.tar.gz` Liara expects for `POST /v2/projects/{name}/sources` [CLI].
 * A zip is listed from its central directory first (nothing inflated), every bound is checked against the
 * declared sizes (per file, total, compression ratio, file count), then entries are inflated one at a time
 * straight into the tar/gzip stream with the declared size as a hard cap on what the inflater may produce.
 * Rejects path traversal, absolute paths, symlinks, encryption, Zip64 and overlapping entries.
 * Ignore rules: CLI defaults + root `.liaraignore`, else `.dockerignore`, else `.gitignore` [CLI].
 */
export async function createSourceArchive(input: SourceInput, opts: ArchiveOptions = {}): Promise<SourceArchive> {
  const {
    maxBytes = MAX_SOURCE_SIZE,
    maxUncompressedBytes = MAX_SOURCE_UNCOMPRESSED_BYTES,
    maxFileBytes = MAX_SOURCE_FILE_BYTES,
    maxFiles = MAX_SOURCE_FILES,
    applyIgnore = true,
    stripSingleRoot = true,
  } = opts;
  const isZip = "zip" in input;
  let listed: PlannedFile[];
  if (isZip) {
    listed = listZip(input.zip, maxFiles);
  } else {
    if (input.files.length > maxFiles) throw new SourceArchiveError("too_many_files", "Too many files in archive");
    listed = input.files.map((f) => {
      if (f.mode !== undefined && (f.mode & S_IFMT) === S_IFLNK) throw new SourceArchiveError("symlink", `Symlinks are not allowed: ${JSON.stringify(f.path.slice(0, 80))}`);
      const data = typeof f.data === "string" ? Buffer.from(f.data) : f.data;
      return { path: safeEntryPath(f.path), size: data.byteLength, mode: f.mode ? f.mode & 0o777 : 0o644, compressedSize: data.byteLength, data, deflated: false };
    });
  }

  let files = new Map<string, PlannedFile>();
  for (const f of listed) {
    if (!f.path || f.path.startsWith("__MACOSX/") || f.path.endsWith("/.DS_Store")) continue;
    files.set(f.path, f);
  }

  if (isZip && stripSingleRoot && files.size > 0) {
    const tops = new Set([...files.keys()].map((k) => (k.includes("/") ? k.slice(0, k.indexOf("/")) : null)));
    if (tops.size === 1 && !tops.has(null)) {
      const root = [...tops][0] + "/";
      files = new Map([...files].map(([k, v]) => [k.slice(root.length), { ...v, path: k.slice(root.length) }]));
    }
  }

  let ignoredCount = 0;
  if (applyIgnore) {
    const text = (name: string) => {
      const f = files.get(name);
      if (!f) return undefined;
      const bytes = readSmall(f);
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
    };
    const userRules = text(".liaraignore") ?? text(".dockerignore") ?? text(".gitignore") ?? "";
    const ignored = createIgnore(DEFAULT_IGNORES, userRules);
    for (const k of [...files.keys()]) {
      if (ignored(k)) {
        files.delete(k);
        ignoredCount++;
      }
    }
  }
  if (files.size === 0) {
    throw new SourceArchiveError("empty", "No files to upload (everything is empty or ignored by .liaraignore/.dockerignore/.gitignore)");
  }

  // Every bound on the DECLARED sizes before a single byte is inflated.
  let uncompressedBytes = 0;
  let compressedBytes = 0;
  for (const f of files.values()) {
    if (f.size > maxFileBytes) throw new SourceArchiveError("too_large", "A file in the archive is too large when uncompressed");
    if (f.deflated && f.size > 1024 * 1024 && f.size / Math.max(1, f.compressedSize) > MAX_ENTRY_RATIO) {
      throw new SourceArchiveError("too_large", "A zip entry declares an impossible compression ratio");
    }
    uncompressedBytes += f.size;
    compressedBytes += f.compressedSize;
  }
  if (uncompressedBytes > maxUncompressedBytes) throw new SourceArchiveError("too_large", "Archive content is too large when uncompressed");
  if (isZip && isImplausibleSourceRatio(uncompressedBytes, compressedBytes)) throw new SourceArchiveError("too_large", "Archive compression ratio is implausible");

  const data = await packTarGz(files.values(), maxBytes);
  return { data, size: data.length, fileCount: files.size, ignoredCount, uncompressedBytes };
}

// ---- Upload + release ---------------------------------------------------------

/** [V+CLI] POST /v2/projects/{name}/sources (multipart `file`, .tar.gz <= 256 MiB) -> {sourceID}. 413 when too large. */
export async function uploadSource(client: LiaraClient, app: string, archive: Uint8Array, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
  if (archive.length > MAX_SOURCE_SIZE) throw invalidArgument("source archive exceeds 256 MiB");
  const form = new FormData();
  // The Blob takes its own copy; avoid a second one when the bytes already sit in a plain ArrayBuffer.
  const part = archive.buffer instanceof ArrayBuffer ? new Uint8Array(archive.buffer, archive.byteOffset, archive.byteLength) : Buffer.from(archive);
  form.append("file", new Blob([part], { type: "application/gzip" }), "source.tar.gz");
  const res = await client.post(`/v2/projects/${seg(app)}/sources`, SourceUploadSchema, { form, signal: opts.signal, timeoutMs: opts.timeoutMs ?? 10 * 60_000 });
  return res.sourceID;
}

export interface ReleaseCommon {
  port: number;
  /** Platform, e.g. "node". Forced to "docker" for image releases. */
  type: AppPlatform | (string & {});
  message?: string;
  build?: { cache?: boolean; args?: Record<string, string>; dockerfile?: string; location?: "iran" | "germany" };
  cron?: string[];
  args?: string[];
  disks?: Array<{ name: string; mountTo: string }>;
  /** Release-level env map [CLI liara.json `envs`]. Prefer `updateEnvs` for managed variables. */
  envs?: Record<string, string>;
  healthCheck?: Record<string, unknown>;
  gitInfo?: Record<string, unknown>;
  platformConfig?: Record<string, unknown>;
}
export type CreateReleaseInput = ReleaseCommon & ({ sourceID: string; image?: never } | { image: string; sourceID?: never });

/**
 * [V+CLI] POST /v2/projects/{name}/releases -> {releaseID}. Starts a build/deploy (BILLED resources; 428
 * max_deployment_count_in_day = daily cap; 400 frozen_project = no balance).
 * Body fields follow the CLI (`deploy.ts`); only the keys the caller sets are sent.
 */
export async function createRelease(client: LiaraClient, app: string, input: CreateReleaseInput): Promise<string> {
  if (!input.sourceID === !input.image) throw invalidArgument("provide exactly one of sourceID or image");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw invalidArgument("port must be 1-65535");
  const { sourceID, image, ...rest } = input;
  const body = { ...rest, ...(image ? { image, type: "docker" } : { sourceID }) };
  return (await client.post(`/v2/projects/${seg(app)}/releases`, CreatedReleaseSchema, { json: body })).releaseID;
}

/** Archive + upload + create release. Refuses a stopped app (the CLI does the same). */
export async function deploySource(
  client: LiaraClient,
  app: string,
  source: SourceInput,
  release: ReleaseCommon,
  opts: ArchiveOptions & { signal?: AbortSignal } = {},
): Promise<{ releaseID: string; sourceID: string; archive: Omit<SourceArchive, "data"> }> {
  const detail = await getApp(client, app);
  if (detail.scale === 0) throw invalidArgument(`App ${app} is stopped; start it before deploying`);
  const { data, ...archive } = await createSourceArchive(source, opts);
  const sourceID = await uploadSource(client, app, data, { signal: opts.signal });
  const releaseID = await createRelease(client, app, { ...release, sourceID });
  return { releaseID, sourceID, archive };
}

// ---- Watch ------------------------------------------------------------------

/** Terminal release states [CLI services/build-logs.ts]. */
export const TERMINAL_RELEASE_STATES = ["READY", "FAILED", "CANCELED", "TIMEDOUT", "UNHEALTHY"] as const;
const isTerminal = (s?: string) => (TERMINAL_RELEASE_STATES as readonly string[]).includes(s ?? "");

export type WatchEvent =
  | { kind: "state"; state: string; queue?: number }
  | { kind: "log"; stream: "STDOUT" | "STDERR"; line: string; createdAt?: string }
  | { kind: "done"; state: string; ok: boolean; failReason?: string; reason?: "build_stderr" | "watch_timeout" };

export interface WatchOptions {
  signal?: AbortSignal;
  /** Poll interval while queued (default 3000). */
  queueIntervalMs?: number;
  /** Poll interval for build logs/state (default 1000). */
  logIntervalMs?: number;
  /** Give up after this long (default 30 min). */
  timeoutMs?: number;
  /** false for image releases: poll only `GET /v1/releases/{id}` (default true). */
  buildLogs?: boolean;
  maxConsecutiveErrors?: number;
}

/**
 * Follow a release to completion [CLI deploy.ts showBuildLogs + services/build-logs.ts]:
 * poll the queue every ~3 s, then build logs every ~1 s (cursor = createdAt of the last line,
 * de-duplicated by line id). A STDERR build line ends the watch as failed [CLI]; otherwise it
 * ends on READY/FAILED/CANCELED/TIMEDOUT/UNHEALTHY. Transient poll errors are tolerated.
 */
export async function* watchRelease(client: LiaraClient, releaseId: string, opts: WatchOptions = {}): AsyncGenerator<WatchEvent> {
  const { signal, queueIntervalMs = 3000, logIntervalMs = 1000, timeoutMs = 30 * 60_000, buildLogs = true, maxConsecutiveErrors = 5 } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastState: string | undefined;
  let lastQueue: number | undefined;
  let since: string | undefined;
  let errors = 0;
  const seen = new Set<string>();

  const tolerate = (e: unknown) => {
    if (isLiaraError(e) && ["auth", "forbidden", "not_found"].includes(e.kind)) throw e;
    if (++errors > maxConsecutiveErrors) throw e;
  };
  const stateEvent = (r: Release): WatchEvent | undefined => {
    const queue = r.queue || 0;
    if (r.state === lastState && queue === lastQueue) return undefined;
    lastState = r.state;
    lastQueue = queue;
    return { kind: "state", state: r.state ?? "UNKNOWN", ...(queue ? { queue } : {}) };
  };
  const done = (r: Release): WatchEvent => ({ kind: "done", state: r.state ?? "UNKNOWN", ok: r.state === "READY", ...(r.failReason ? { failReason: r.failReason } : {}) });
  const timedOut: WatchEvent = { kind: "done", state: "TIMEDOUT", ok: false, reason: "watch_timeout" };

  // Phase 1: wait in the build queue.
  while (!signal?.aborted) {
    if (Date.now() > deadline) return void (yield timedOut);
    try {
      const r = await getRelease(client, releaseId, signal);
      errors = 0;
      const ev = stateEvent(r);
      if (ev) yield ev;
      if (isTerminal(r.state)) return void (yield done(r));
      if (!r.queue) break;
    } catch (e) {
      tolerate(e);
    }
    await sleep(queueIntervalMs, signal);
  }

  // Phase 2: build output + state.
  while (!signal?.aborted) {
    if (Date.now() > deadline) return void (yield timedOut);
    try {
      let release: Release | undefined;
      let lines: Awaited<ReturnType<typeof getBuildLogs>>["buildOutput"] = [];
      if (buildLogs) {
        const r = await getBuildLogs(client, releaseId, { since, signal });
        release = r.release;
        lines = r.buildOutput;
      } else {
        release = await getRelease(client, releaseId, signal);
      }
      errors = 0;
      const ev = release && stateEvent(release);
      if (ev) yield ev;
      for (const l of lines) {
        const key = buildLineKey(l);
        if (seen.has(key)) continue;
        seen.add(key);
        const stream = l.stream === "STDERR" ? "STDERR" : "STDOUT";
        yield { kind: "log", stream, line: l.line, createdAt: l.createdAt };
        if (stream === "STDERR") return void (yield { kind: "done", state: "FAILED", ok: false, reason: "build_stderr", ...(release?.failReason ? { failReason: release.failReason } : {}) });
      }
      const last = lines.at(-1);
      if (last?.createdAt) since = last.createdAt;
      if (!lines.length && release && isTerminal(release.state)) return void (yield done(release));
    } catch (e) {
      tolerate(e);
    }
    await sleep(logIntervalMs, signal);
  }
}
