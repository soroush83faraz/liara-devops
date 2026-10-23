// S2 regression: zip bombs on the deploy path. Before the fix createSourceArchive inflated the whole zip in memory
// (fflate unzipSync, 1 GiB uncompressed allowed) and copied it twice more: a 256 KB zip cost ~985 MB.
// SYNTHETIC archives only (tests/unit/security/archive-bombs.ts).
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { deflateRawSync, crc32 } from "node:zlib";
import {
  createSourceArchive,
  MAX_SOURCE_FILES,
  MAX_SOURCE_UNCOMPRESSED_BYTES,
  SourceArchiveError,
} from "@/lib/liara";
import { scanTarGz } from "@/lib/create/tar-scan";
import { MAX_ARCHIVE_FILES, MAX_TAR_UNCOMPRESSED_BYTES } from "@/lib/create/limits";
import { buildZip, deflatedZeros, gzipWithZeroTail, peakMemoryDuring, tarFile, zeroBombZip } from "./archive-bombs";

const MiB = 1024 * 1024;
const codeOf = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as SourceArchiveError).code : "ACCEPTED");

describe("createSourceArchive: zip bombs are refused with bounded memory", () => {
  it("the verifier's 256 KB zip (4 x 64 MiB of zeros) is rejected before anything is inflated", async () => {
    const zip = await zeroBombZip(4, 64 * MiB);
    expect(zip.byteLength).toBeLessThan(400 * 1024);
    const run = await peakMemoryDuring(() => createSourceArchive({ zip }));
    expect(codeOf(run.result)).toBe("too_large");
    expect(run.heapAndBuffers).toBeLessThan(100 * MiB);
  }, 60_000);

  it("the verifier's 512 KB zip (4 x 128 MiB, over the total cap) is rejected with bounded memory", async () => {
    const zip = await zeroBombZip(4, 128 * MiB);
    const run = await peakMemoryDuring(() => createSourceArchive({ zip }));
    expect(codeOf(run.result)).toBe("too_large");
    expect(run.heapAndBuffers).toBeLessThan(100 * MiB);
  }, 60_000);

  it("a header that UNDER-declares its size is cut off at the declared size (headers lie)", async () => {
    // Declares 1 MiB; the deflate stream really expands to 48 MiB.
    const { data, crc } = await deflatedZeros(48 * MiB);
    const zip = buildZip([
      { name: "package.json", data: Buffer.from("{}"), method: 0, crc: crc32(Buffer.from("{}")), size: 2 },
      { name: "liar.bin", data, method: 8, crc, size: 1 * MiB },
    ]);
    const run = await peakMemoryDuring(() => createSourceArchive({ zip }));
    expect(codeOf(run.result)).toBe("too_large");
    expect(run.heapAndBuffers).toBeLessThan(40 * MiB);
  }, 60_000);

  it("a header that OVER-declares its size is refused (no silent truncation)", async () => {
    const real = Buffer.from("console.log('x')");
    const zip = buildZip([{ name: "index.js", data: deflateRawSync(real), method: 8, crc: crc32(real), size: real.length + 100 }]);
    expect(codeOf((await Promise.allSettled([createSourceArchive({ zip })]))[0])).toBe("invalid_zip");
  });

  it("overlapping entries (one compressed kernel referenced by many directory records) are refused", async () => {
    const { data, crc } = await deflatedZeros(1 * MiB);
    const zip = buildZip([{ name: "kernel.bin", data, method: 8, crc, size: 1 * MiB }], 20);
    expect(codeOf((await Promise.allSettled([createSourceArchive({ zip })]))[0])).toBe("too_large");
  });

  it("enforces the per-file cap, the ratio guard and the entry cap on DECLARED sizes", async () => {
    const zip = zipSync({ "a.txt": strToU8("x".repeat(5000)), "b.txt": strToU8("ok") });
    expect(codeOf((await Promise.allSettled([createSourceArchive({ zip }, { maxFileBytes: 1000 })]))[0])).toBe("too_large");
    // 80 MiB of zeros in ~80 KB: over the ratio trigger and far above 100:1, though under every size cap.
    const ratio = await zeroBombZip(1, 80 * MiB);
    expect(codeOf((await Promise.allSettled([createSourceArchive({ zip: ratio })]))[0])).toBe("too_large");
    const many = zipSync(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.txt`, strToU8("x")])));
    expect(codeOf((await Promise.allSettled([createSourceArchive({ zip: many }, { maxFiles: 10 })]))[0])).toBe("too_many_files");
  });

  it("still repacks a normal project", async () => {
    const zip = zipSync({ "proj/package.json": strToU8("{}"), "proj/src/a.js": strToU8("a".repeat(100_000)) });
    const a = await createSourceArchive({ zip });
    expect(a.fileCount).toBe(2);
    expect(a.uncompressedBytes).toBe(100_002);
  });

  it("the default bounds are the 256 MiB budget shared with the tar.gz scan", () => {
    expect(MAX_SOURCE_UNCOMPRESSED_BYTES).toBeLessThanOrEqual(256 * MiB);
    expect(MAX_TAR_UNCOMPRESSED_BYTES).toBe(MAX_SOURCE_UNCOMPRESSED_BYTES);
    expect(MAX_ARCHIVE_FILES).toBe(MAX_SOURCE_FILES);
  });
});

describe("scanTarGz: bombs in a forwarded .tar.gz", () => {
  it("counts the bytes the decompressor really produces (300 MiB of zeros hidden after the end marker)", async () => {
    const tgz = await gzipWithZeroTail(Buffer.concat([tarFile("package.json", "{}"), Buffer.alloc(1024)]), 300 * MiB);
    expect(tgz.byteLength).toBeLessThan(1 * MiB);
    const run = await peakMemoryDuring(() => scanTarGz(tgz));
    expect(codeOf(run.result)).toBe("too_large");
    expect(run.heapAndBuffers).toBeLessThan(64 * MiB);
  }, 60_000);

  it("an honest but huge entry is refused by the budget, not trusted from the header", async () => {
    const tgz = await gzipWithZeroTail(Buffer.from(""), 0);
    expect(codeOf((await Promise.allSettled([scanTarGz(tgz)]))[0])).not.toBe("ACCEPTED");
    const small = await gzipWithZeroTail(Buffer.concat([tarFile("a.txt", "x".repeat(4096)), Buffer.alloc(1024)]), 0);
    expect(codeOf((await Promise.allSettled([scanTarGz(small, { maxUncompressedBytes: 2048 })]))[0])).toBe("too_large");
    expect(await scanTarGz(small)).toEqual({ files: 1, uncompressedBytes: 4096 });
  });
});
