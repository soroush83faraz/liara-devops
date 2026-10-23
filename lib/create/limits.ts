// Shared (client + server) limits. Kept free of server imports so the wizard bundle stays small.

/** Compressed source limit [CLI] MAX_SOURCE_SIZE (asserted equal to lib/liara/deploy in tests). */
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
/** Multipart overhead allowance on top of the file. */
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
export const MAX_DEPLOY_BODY_BYTES = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES;
/** JSON bodies (image deploys) are tiny. */
export const MAX_JSON_BODY_BYTES = 16 * 1024;
/** Uncompressed limit when scanning a .tar.gz we do not repack (asserted equal to lib/liara/deploy MAX_SOURCE_UNCOMPRESSED_BYTES). */
export const MAX_TAR_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
/** Asserted equal to lib/liara/deploy MAX_SOURCE_FILES. */
export const MAX_ARCHIVE_FILES = 50_000;

export const DEPLOY_RATE_LIMIT = { limit: 5, windowMs: 60_000 } as const;
export const HOURS_PER_MONTH = 720;
