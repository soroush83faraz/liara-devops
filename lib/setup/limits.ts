// Hard resource limits for every archive parse. Archives are untrusted input: nothing here is configurable
// from the request, and every parse path checks them before allocating.
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024; // compressed (same cap as Liara's source upload)
export const MAX_COUNTED_ENTRIES = 50_000; // files outside ignored dirs
export const MAX_RAW_ENTRIES = 200_000; // every entry incl. ignored dirs (zip itself caps at 65,535 without zip64)
export const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // declared/streamed budget over all entries
export const MAX_INSPECTED_FILE_BYTES = 5 * 1024 * 1024; // a file we read must be smaller than this
export const MAX_RETAINED_FILES = 400; // files we keep in memory for the detector
export const MAX_RETAINED_BYTES = 24 * 1024 * 1024;
export const MAX_PATH_DEPTH = 32;
export const MAX_PATH_LENGTH = 400;
export const MAX_RATIO_TRIGGER_BYTES = 64 * 1024 * 1024; // ratio guard only applies above this size
export const MAX_RATIO = 100; // uncompressed / compressed
export const MAX_ENTRY_RATIO = 2000; // single entry (>1 MiB) ratio
export const MAX_PARSE_MS = 20_000;
export const MAX_META_BYTES = 64 * 1024; // tar pax / longname payload
export const MAX_DESCRIPTION_CHARS = 2000;
export const LARGE_PROJECT_BYTES = 100 * 1024 * 1024;

/** Directory names never listed, never read (build output, VCS, vendored deps, caches). */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", ".svn", ".hg", "venv", ".venv", "__pycache__", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".cache", "dist", "build", "out", "target", "bin", "obj", "vendor", ".gradle", ".idea", ".vscode",
  "__MACOSX", "coverage", ".pytest_cache", ".mypy_cache", ".tox", "site-packages",
]);

export interface ArchiveLimits {
  maxArchiveBytes: number;
  maxCountedEntries: number;
  maxRawEntries: number;
  maxUncompressedBytes: number;
  maxInspectedFileBytes: number;
  maxRetainedFiles: number;
  maxRetainedBytes: number;
  maxDepth: number;
  maxParseMs: number;
}

export const DEFAULT_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  maxArchiveBytes: MAX_ARCHIVE_BYTES,
  maxCountedEntries: MAX_COUNTED_ENTRIES,
  maxRawEntries: MAX_RAW_ENTRIES,
  maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
  maxInspectedFileBytes: MAX_INSPECTED_FILE_BYTES,
  maxRetainedFiles: MAX_RETAINED_FILES,
  maxRetainedBytes: MAX_RETAINED_BYTES,
  maxDepth: MAX_PATH_DEPTH,
  maxParseMs: MAX_PARSE_MS,
});
