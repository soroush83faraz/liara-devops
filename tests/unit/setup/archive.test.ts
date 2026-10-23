import { describe, expect, it } from "vitest";
import { strToU8, zipSync, type Zippable } from "fflate";
import { ArchiveError, detectArchiveFormat, openArchive } from "@/lib/setup/archive";
import { transformFile, wantsFile } from "@/lib/setup/detect";
import { DEFAULT_LIMITS, MAX_COUNTED_ENTRIES, MAX_INSPECTED_FILE_BYTES, MAX_UNCOMPRESSED_BYTES, MAX_ARCHIVE_BYTES } from "@/lib/setup/limits";
import { fixture, tarGzOf, zipOf } from "./helpers";

const open = (bytes: Uint8Array, limits = {}) => openArchive(bytes, { wants: wantsFile, transform: transformFile, limits });
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ArchiveError) return e.code;
    throw e;
  }
  return "no-error";
};
const zip = (files: Zippable) => zipSync(files);

describe("hard limits are the documented ones", () => {
  it("matches the spec", () => {
    expect(MAX_ARCHIVE_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_COUNTED_ENTRIES).toBe(50_000);
    expect(MAX_UNCOMPRESSED_BYTES).toBe(1024 * 1024 * 1024);
    expect(MAX_INSPECTED_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxDepth).toBeGreaterThan(0);
  });
});

describe("zip path safety", () => {
  it.each([
    ["parent traversal", "../evil.txt"],
    ["nested traversal", "a/../../evil.txt"],
    ["absolute path", "/etc/passwd"],
    ["windows drive", "C:/Windows/x"],
    ["backslash traversal", "..\\evil.txt"],
  ])("rejects %s", async (_label, name) => {
    expect(await codeOf(open(zip({ [name]: strToU8("x"), "package.json": strToU8("{}") })))).toBe("unsafe_path");
  });

  it("rejects traversal even inside an ignored directory", async () => {
    expect(await codeOf(open(zip({ "node_modules/../../evil": strToU8("x"), "package.json": strToU8("{}") })))).toBe("unsafe_path");
  });

  it("rejects symlink entries (zip)", async () => {
    const bytes = zip({ "package.json": strToU8("{}"), link: [strToU8("/etc/passwd"), { os: 3, attrs: (0o120777 << 16) >>> 0 }] });
    expect(await codeOf(open(bytes))).toBe("symlink");
  });

  it("rejects symlinks and hard links (tar.gz)", async () => {
    expect(await codeOf(open(tarGzOf({ "package.json": "{}" }, [{ name: "ln", type: "2", linkname: "/etc/passwd" }])))).toBe("symlink");
    expect(await codeOf(open(tarGzOf({ "package.json": "{}" }, [{ name: "hl", type: "1", linkname: "package.json" }])))).toBe("symlink");
  });

  it("rejects traversal in tar.gz", async () => {
    expect(await codeOf(open(tarGzOf({ "../evil": "x", "package.json": "{}" })))).toBe("unsafe_path");
  });

  it("rejects unreasonably deep paths", async () => {
    const deep = Array.from({ length: 40 }, (_, i) => `d${i}`).join("/") + "/f.txt";
    expect(await codeOf(open(zip({ [deep]: strToU8("x") })))).toBe("too_deep");
  });
});

describe("size and shape guards", () => {
  it("rejects empty, unknown and oversized input", async () => {
    expect(await codeOf(open(new Uint8Array(0)))).toBe("empty");
    expect(await codeOf(open(strToU8("not an archive at all")))).toBe("unsupported_format");
    expect(await codeOf(open(zipOf(fixture("express")), { maxArchiveBytes: 100 }))).toBe("too_large");
  });

  it("detects the format from magic bytes, not names", () => {
    expect(detectArchiveFormat(zipOf({ a: "b" }))).toBe("zip");
    expect(detectArchiveFormat(tarGzOf({ a: "b" }))).toBe("tgz");
    expect(detectArchiveFormat(strToU8("hello"))).toBeNull();
  });

  it("enforces the entry-count limit", async () => {
    const many: Zippable = {};
    for (let i = 0; i < 20; i++) many[`f${i}.txt`] = strToU8("x");
    expect(await codeOf(open(zip(many), { maxCountedEntries: 10 }))).toBe("too_many_entries");
    expect(await codeOf(open(tarGzOf(Object.fromEntries(Object.keys(many).map((k) => [k, "x"]))), { maxCountedEntries: 10 }))).toBe("too_many_entries");
  });

  it("ignored directories do not count toward the file limit", async () => {
    const files: Zippable = { "package.json": strToU8("{}") };
    for (let i = 0; i < 30; i++) files[`node_modules/m${i}/index.js`] = strToU8("x");
    const opened = await open(zip(files), { maxCountedEntries: 5 });
    expect(opened.paths).toEqual(["package.json"]);
  });

  it("the uncompressed budget counts every entry", async () => {
    expect(await codeOf(open(zip({ "a.bin": new Uint8Array(4096), "b.bin": new Uint8Array(4096) }), { maxUncompressedBytes: 5000 }))).toBe("too_large");
  });

  it("detects a zip bomb by compression ratio (zip and tar.gz)", async () => {
    const zeros = new Uint8Array(80 * 1024 * 1024);
    expect(await codeOf(open(zip({ "big.bin": zeros })))).toBe("bomb");
    expect(await codeOf(open(tarGzOf({ "big.bin": "\0".repeat(80 * 1024 * 1024) })))).toBe("bomb");
  });

  it("a header that under-declares its size cannot make us inflate more than declared", async () => {
    const bytes = zip({ "package.json": strToU8(JSON.stringify({ pad: "a".repeat(2000) })) });
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cd = -1;
    for (let i = bytes.length - 4; i >= 0; i--) if (dv.getUint32(i, true) === 0x02014b50) { cd = i; break; }
    expect(cd).toBeGreaterThan(0);
    dv.setUint32(cd + 24, 10, true);
    expect(await codeOf(open(bytes))).toBe("bomb");
  });

  it("stops when parsing takes too long", async () => {
    let t = 0;
    const files: Zippable = {};
    for (let i = 0; i < 1100; i++) files[`f${i}.txt`] = strToU8("x");
    const p = openArchive(zip(files), { wants: wantsFile, now: () => (t += 30_000) });
    expect(await codeOf(p)).toBe("timeout");
  });
});

describe("what the reader keeps", () => {
  it("does not read files the detector did not ask for", async () => {
    const opened = await open(zip({ "package.json": strToU8("{}"), "src/big.js": strToU8("secret-looking content"), "README.md": strToU8("# hi") }));
    expect(opened.read("package.json")).toBe("{}");
    expect(opened.read("src/big.js")).toBeUndefined();
    expect(opened.paths).toContain("src/big.js");
  });

  it("skips files larger than the inspection limit and counts them", async () => {
    const huge = "x".repeat(MAX_INSPECTED_FILE_BYTES + 10);
    const opened = await open(zip({ "package.json": strToU8(huge) }));
    expect(opened.read("package.json")).toBeUndefined();
    expect(opened.skippedLarge).toBe(1);
  });

  it("returns .env files as names only", async () => {
    const opened = await open(zip({ ".env": strToU8("TOKEN=abc123SECRETvalue\nURL=postgres://u:p@h/db\n") }));
    const text = opened.read(".env") ?? "";
    expect(text).toContain("TOKEN");
    expect(text).not.toContain("abc123SECRETvalue");
    expect(text).not.toContain("u:p@h");
  });

  it("skips binary files even when their name matches", async () => {
    const opened = await open(zip({ "package.json": new Uint8Array([0x7b, 0, 0, 0x7d]) }));
    expect(opened.read("package.json")).toBeUndefined();
  });
});
