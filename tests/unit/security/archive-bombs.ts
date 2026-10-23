// SYNTHETIC hostile archives for the zip-bomb / tar regression tests. The builders stream zeros through zlib from
// one reused 1 MiB buffer, so a "256 MiB" bomb costs the test ~1 MiB of memory to build.
import { once } from "node:events";
import { createDeflateRaw, createGzip, crc32 } from "node:zlib";

const ONE_MIB = 1024 * 1024;
const ZERO_CHUNK = Buffer.alloc(ONE_MIB);

async function drain(stream: NodeJS.ReadWriteStream & { write(b: Buffer): boolean; end(): void }, feed: () => Generator<Buffer>): Promise<Buffer> {
  const out: Buffer[] = [];
  stream.on("data", (c: Buffer) => out.push(c));
  const ended = new Promise<void>((resolve, reject) => {
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  for (const piece of feed()) if (!stream.write(piece)) await once(stream, "drain");
  stream.end();
  await ended;
  return Buffer.concat(out);
}

function* zeros(total: number): Generator<Buffer> {
  for (let left = total; left > 0; left -= ONE_MIB) yield left >= ONE_MIB ? ZERO_CHUNK : ZERO_CHUNK.subarray(0, left);
}

/** Raw deflate of `total` zero bytes plus its CRC32. */
export async function deflatedZeros(total: number): Promise<{ data: Buffer; crc: number }> {
  let crc = 0;
  for (const z of zeros(total)) crc = crc32(z, crc);
  return { data: await drain(createDeflateRaw({ level: 9 }), () => zeros(total)), crc };
}

export interface ZipPart {
  name: string;
  /** Raw-deflate (method 8) or stored (method 0) bytes. */
  data: Buffer;
  method: 0 | 8;
  crc: number;
  /** DECLARED uncompressed size (a lying header uses a different value than the real one). */
  size: number;
}

/**
 * Minimal zip writer. `aliases` adds extra central-directory records that point at the FIRST entry's local header
 * (the "overlapping entries" bomb: one compressed kernel referenced many times).
 */
export function buildZip(parts: ZipPart[], aliases = 0): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  const cdRecord = (p: ZipPart, name: Buffer, offset: number) => {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(p.method, 10);
    cd.writeUInt32LE(p.crc >>> 0, 16);
    cd.writeUInt32LE(p.data.length, 20);
    cd.writeUInt32LE(p.size, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    return Buffer.concat([cd, name]);
  };
  let offset = 0;
  for (const p of parts) {
    const name = Buffer.from(p.name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(p.method, 8);
    lh.writeUInt32LE(p.crc >>> 0, 14);
    lh.writeUInt32LE(p.data.length, 18);
    lh.writeUInt32LE(p.size, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, p.data);
    central.push(cdRecord(p, name, offset));
    offset += 30 + name.length + p.data.length;
  }
  for (let i = 0; i < aliases; i++) central.push(cdRecord(parts[0], Buffer.from(`alias-${i}.bin`), 0));
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length + aliases, 8);
  eocd.writeUInt16LE(parts.length + aliases, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

/** The verifier's bomb: `files` entries of `perFile` zero bytes each, honestly declared, deflate level 9. */
export async function zeroBombZip(files: number, perFile: number): Promise<Uint8Array> {
  const { data, crc } = await deflatedZeros(perFile);
  return buildZip(Array.from({ length: files }, (_, i) => ({ name: `proj/f${i}.txt`, data, method: 8 as const, crc, size: perFile })));
}

/** One tar header block (ustar), checksum filled in. */
export function tarHeader(name: string, size: number, type: string, extra: { linkname?: string; magic?: "posix" | "gnu" } = {}): Buffer {
  const b = Buffer.alloc(512);
  b.write(name, 0, 100, "utf8");
  b.write("0000644\0", 100);
  b.write("0000000\0", 108);
  b.write("0000000\0", 116);
  b.write(size.toString(8).padStart(11, "0") + "\0", 124);
  b.write("00000000000\0", 136);
  b.write("        ", 148);
  b.write(type, 156);
  if (extra.linkname) b.write(extra.linkname, 157, 100, "utf8");
  if (extra.magic === "gnu") b.write("ustar  \0", 257, "latin1");
  else b.write("ustar\0" + "00", 257, "latin1");
  let sum = 0;
  for (const x of b) sum += x;
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return b;
}

export function tarPad(data: Buffer): Buffer {
  const r = data.length % 512;
  return r ? Buffer.concat([data, Buffer.alloc(512 - r)]) : data;
}

/** A pax record "<len> key=value\n" with the self-referential length computed. */
export function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}

/** Plain tar file entry (header + padded data). */
export function tarFile(name: string, body: string): Buffer {
  const data = Buffer.from(body);
  return Buffer.concat([tarHeader(name, data.length, "0"), tarPad(data)]);
}

/** gzip of `tar` followed by `trailingZeros` zero bytes inside the SAME gzip member (streamed, never allocated). */
export async function gzipWithZeroTail(tar: Buffer, trailingZeros: number): Promise<Uint8Array> {
  return new Uint8Array(
    await drain(createGzip({ level: 9 }), function* () {
      yield tar;
      yield* zeros(trailingZeros);
    }),
  );
}

/** Samples memory while `fn` runs; returns the peak growth of (heapUsed + arrayBuffers) and of rss, in bytes. */
export async function peakMemoryDuring<T>(fn: () => Promise<T>): Promise<{ result: PromiseSettledResult<T>; heapAndBuffers: number; rss: number }> {
  const g = globalThis as { gc?: () => void };
  g.gc?.();
  const base = process.memoryUsage();
  let peakHb = 0;
  let peakRss = 0;
  const sample = () => {
    const m = process.memoryUsage();
    peakHb = Math.max(peakHb, m.heapUsed + m.arrayBuffers - (base.heapUsed + base.arrayBuffers));
    peakRss = Math.max(peakRss, m.rss - base.rss);
  };
  const timer = setInterval(sample, 2);
  const [result] = await Promise.allSettled([fn()]);
  sample();
  clearInterval(timer);
  return { result, heapAndBuffers: peakHb, rss: peakRss };
}
