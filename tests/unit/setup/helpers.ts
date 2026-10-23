import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import { openArchive } from "@/lib/setup/archive";
import { analyzeProject, transformFile, wantsFile } from "@/lib/setup/detect";
import type { ProjectAnalysis } from "@/lib/setup/types";

export type Tree = Record<string, string>;

export function fixture(name: string): Tree {
  const raw = readFileSync(path.join(process.cwd(), "tests/fixtures/projects", `${name}.synthetic.json`), "utf8");
  const doc = JSON.parse(raw) as { files: Tree };
  return doc.files;
}

export function zipOf(tree: Tree, opts: { prefix?: string } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [p, c] of Object.entries(tree)) files[`${opts.prefix ?? ""}${p}`] = strToU8(c);
  return zipSync(files);
}

/** Minimal ustar writer (regular files only) so tests can build tar.gz archives without extra deps. */
export function tarGzOf(tree: Tree, extra: Array<{ name: string; type?: string; body?: string; linkname?: string }> = []): Uint8Array {
  const blocks: Buffer[] = [];
  const entries = [
    ...Object.entries(tree).map(([name, body]) => ({ name, type: "0", body, linkname: "" })),
    ...extra.map((e) => ({ name: e.name, type: e.type ?? "0", body: e.body ?? "", linkname: e.linkname ?? "" })),
  ];
  for (const e of entries) {
    const body = Buffer.from(e.body);
    const h = Buffer.alloc(512);
    h.write(e.name.slice(0, 100), 0, "utf8");
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write(e.type, 156);
    h.write(e.linkname.slice(0, 100), 157);
    h.write("ustar\0" + "00", 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

export async function analyzeBytes(bytes: Uint8Array): Promise<ProjectAnalysis> {
  const opened = await openArchive(bytes, { wants: wantsFile, transform: transformFile });
  return analyzeProject(opened);
}

export async function analyzeFixture(name: string): Promise<ProjectAnalysis> {
  return analyzeBytes(zipOf(fixture(name)));
}
