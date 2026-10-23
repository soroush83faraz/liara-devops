// S7 regression: the deploy-side tar.gz scan (forwarded to Liara unchanged) and the setup analyzer must refuse
// every entry an extractor could turn into something other than a regular file/directory inside the project, and
// anything hidden from one reader but visible to another. Matrix from the verifier's tar.poc.ts. SYNTHETIC data.
import { gzipSync } from "node:zlib";
import * as tar from "tar-stream";
import { describe, expect, it } from "vitest";
import { scanTarGz } from "@/lib/create/tar-scan";
import { analyzeArchiveBytes } from "@/lib/setup/analyze";
import { paxRecord, tarFile, tarHeader, tarPad } from "./archive-bombs";

type TarEntry = [Partial<tar.Header> & { name: string }, string | null];

async function packTgz(entries: TarEntry[]): Promise<Uint8Array> {
  const p = tar.pack();
  const chunks: Buffer[] = [];
  const done = (async () => {
    for await (const c of p) chunks.push(Buffer.from(c as Buffer));
  })();
  for (const [h, d] of entries) {
    await new Promise<void>((resolve, reject) => {
      const cb = (e?: Error | null) => (e ? reject(e) : resolve());
      if (d === null) p.entry(h as tar.Header, cb);
      else p.entry(h as tar.Header, d, cb);
    });
  }
  p.finalize();
  await done;
  return new Uint8Array(gzipSync(Buffer.concat(chunks)));
}

const EOA = Buffer.alloc(1024);
const gz = (...parts: Buffer[]) => new Uint8Array(gzipSync(Buffer.concat(parts)));
const meta = (type: "x" | "g" | "L" | "K", payload: string, name = "PaxHeader") => {
  const data = Buffer.from(payload);
  return Buffer.concat([tarHeader(name, data.length, type), tarPad(data)]);
};

async function outcome(bytes: Uint8Array): Promise<{ deploy: string; setup: string }> {
  const settle = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ACCEPTED";
    } catch (e) {
      return `rejected:${(e as { code?: string }).code ?? (e as Error).message}`;
    }
  };
  return { deploy: await settle(scanTarGz(bytes)), setup: await settle(analyzeArchiveBytes(bytes)) };
}

describe("strict tar.gz scanning (deploy scan + setup analyzer)", () => {
  const hostile: Array<[string, () => Promise<Uint8Array>]> = [
    ["dotdot", () => packTgz([[{ name: "../evil.txt" }, "x"]])],
    ["absolute", () => packTgz([[{ name: "/etc/x" }, "x"]])],
    ["symlink", () => packTgz([[{ name: "a", type: "symlink", linkname: "/etc/passwd" }, null]])],
    ["hardlink", () => packTgz([[{ name: "a", type: "link", linkname: "/etc/passwd" }, null]])],
    ["pax path traversal", async () => gz(meta("x", paxRecord("path", "../../pax-evil")), tarFile("ok.txt", "x"), EOA)],
    ["long name traversal", () => packTgz([[{ name: "a/".repeat(60) + "../".repeat(70) + "x" }, "x"]])],
    ["character device", () => packTgz([[{ name: "dev", type: "character-device", devmajor: 1, devminor: 3 }, null], [{ name: "f.txt" }, "x"]])],
    ["block device", () => packTgz([[{ name: "blk", type: "block-device", devmajor: 8, devminor: 0 }, null], [{ name: "f.txt" }, "x"]])],
    ["fifo", () => packTgz([[{ name: "fifo", type: "fifo" }, null], [{ name: "f.txt" }, "x"]])],
    ["pax GLOBAL header with a path", async () => gz(meta("g", paxRecord("path", "../../global-evil"), "pax_global"), tarFile("f.txt", "x"), EOA)],
    ["pax linkpath", async () => gz(meta("x", paxRecord("linkpath", "/etc/shadow")), tarFile("f.txt", "x"), EOA)],
    ["pax size override", async () => gz(meta("x", paxRecord("size", "1")), tarFile("f.txt", "xx"), EOA)],
    ["pax GNU.sparse name", async () => gz(meta("x", paxRecord("GNU.sparse.name", "../../sparse-evil")), tarFile("f.txt", "x"), EOA)],
    ["GNU long name L with traversal", async () => gz(meta("L", "../../gnu-evil\0", "././@LongLink"), tarFile("f.txt", "x"), EOA)],
    ["GNU long LINK name K", async () => gz(meta("K", "/etc/shadow\0", "././@LongLink"), tarFile("f.txt", "x"), EOA)],
    ["two name overrides for one entry", async () => gz(meta("L", "a.txt\0", "././@LongLink"), meta("x", paxRecord("path", "b.txt")), tarFile("f.txt", "x"), EOA)],
    ["contiguous file (type 7) with ..", async () => gz(tarHeader("../c7", 1, "7"), tarPad(Buffer.from("x")), EOA)],
    ["GNU sparse entry (type S)", async () => gz(tarHeader("sparse", 0, "S"), tarFile("f.txt", "x"), EOA)],
    ["entry hidden after the end-of-archive marker", async () => gz(tarFile("f.txt", "x"), EOA, tarFile("../after-eoa", "y"), EOA)],
    ["entry after a single zero block", async () => gz(tarFile("f.txt", "x"), Buffer.alloc(512), tarFile("hidden.txt", "y"), EOA)],
    ["concatenated gzip member", async () => new Uint8Array(Buffer.concat([await packTgz([[{ name: "f.txt" }, "x"]]), await packTgz([[{ name: "../member2" }, "x"]])]))],
    ["benign second gzip member", async () => new Uint8Array(Buffer.concat([await packTgz([[{ name: "f.txt" }, "x"]]), await packTgz([[{ name: "g.txt" }, "y"]])]))],
    ["trailing garbage after the gzip trailer", async () => new Uint8Array(Buffer.concat([await packTgz([[{ name: "f.txt" }, "x"]]), Buffer.from("GARBAGE")]))],
    ["corrupt gzip CRC", async () => {
      const b = Buffer.from(await packTgz([[{ name: "f.txt" }, "x"]]));
      b[b.length - 8] ^= 0xff;
      return new Uint8Array(b);
    }],
    ["truncated gzip", async () => (await packTgz([[{ name: "f.txt" }, "x".repeat(10_000)]])).subarray(0, 60)],
    ["metadata with no entry after it", async () => gz(tarFile("f.txt", "x"), meta("x", paxRecord("comment", "dangling")), EOA)],
  ];

  for (const [name, make] of hostile) {
    it(`rejects: ${name}`, async () => {
      const r = await outcome(await make());
      expect(r.deploy, "deploy scan").toMatch(/^rejected:/);
      expect(r.setup, "setup analyzer").toMatch(/^rejected:/);
    });
  }

  const benign: Array<[string, () => Promise<Uint8Array>]> = [
    ["plain project", () => packTgz([[{ name: "package.json" }, "{}"], [{ name: "src/index.js" }, "1"]])],
    ["long path via a local pax header (tar-stream)", () => packTgz([[{ name: "package.json" }, "{}"], [{ name: "deep/".repeat(30) + "file.js" }, "1"]])],
    ["GNU long name (././@LongLink)", async () => gz(tarFile("package.json", "{}"), meta("L", "very/" + "long/".repeat(30) + "name.js\0", "././@LongLink"), tarFile("short", "x"), EOA)],
    ["git archive style global pax comment", async () => gz(meta("g", paxRecord("comment", "0123456789abcdef0123456789abcdef01234567"), "pax_global_header"), tarFile("package.json", "{}"), EOA)],
    ["GNU tar record padding after the end marker", async () => gz(tarFile("package.json", "{}"), Buffer.alloc(10240 - 1024))],
    ["GNU magic header (no ustar prefix field)", async () => gz(Buffer.concat([tarHeader("package.json", 2, "0", { magic: "gnu" }), tarPad(Buffer.from("{}"))]), EOA)],
    ["macOS xattr pax records", async () => gz(meta("x", paxRecord("LIBARCHIVE.xattr.com.apple.quarantine", "MDA4MQ") + paxRecord("SCHILY.dev", "16777220")), tarFile("package.json", "{}"), EOA)],
  ];

  for (const [name, make] of benign) {
    it(`accepts: ${name}`, async () => {
      expect(await outcome(await make())).toEqual({ deploy: "ACCEPTED", setup: "ACCEPTED" });
    });
  }
});
