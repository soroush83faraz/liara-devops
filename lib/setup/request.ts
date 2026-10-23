// Request-level guards for the setup routes: content type, size caps enforced WHILE STREAMING (Content-Length can
// lie or be absent), safe file names. Pure functions so they are unit-testable without Next.js.
import { MAX_ARCHIVE_BYTES } from "./limits";

export type BodyKind = "multipart" | "json";

export const MAX_JSON_BYTES = 64 * 1024;
/** Multipart framing (boundaries, headers) on top of the archive itself. */
export const MULTIPART_OVERHEAD = 1024 * 1024;

export function classifyContentType(header: string | null): BodyKind | null {
  if (!header) return null;
  const type = header.split(";")[0].trim().toLowerCase();
  if (type === "multipart/form-data") return "multipart";
  if (type === "application/json") return "json";
  return null;
}

export type LengthCheck = { ok: true } | { ok: false; status: 400 | 411 | 413 };

/** Fast reject from the declared length; the stream cap below is what actually enforces the limit. */
export function checkContentLength(header: string | null, max: number): LengthCheck {
  if (header === null) return { ok: true };
  if (!/^\d{1,15}$/.test(header.trim())) return { ok: false, status: 400 };
  return Number(header) > max ? { ok: false, status: 413 } : { ok: true };
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("body too large");
    this.name = "BodyTooLargeError";
  }
}

/** Passes bytes through and errors the stream the moment more than `max` bytes have flowed. */
export function limitStream(source: ReadableStream<Uint8Array>, max: number): { stream: ReadableStream<Uint8Array>; exceeded: () => boolean } {
  let seen = 0;
  let over = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max) {
        over = true;
        controller.error(new BodyTooLargeError());
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return { stream: source.pipeThrough(counter), exceeded: () => over };
}

/** Reads a request body into memory with a hard cap. Throws BodyTooLargeError. */
export async function readBodyCapped(request: Request, max: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const { stream, exceeded } = limitStream(request.body, max);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (e) {
    if (exceeded()) throw new BodyTooLargeError();
    throw e;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** multipart/form-data with the same streaming cap (the parser only ever sees the capped stream). */
export async function readFormDataCapped(request: Request, max = MAX_ARCHIVE_BYTES + MULTIPART_OVERHEAD): Promise<FormData> {
  if (!request.body) throw new TypeError("empty body");
  const { stream, exceeded } = limitStream(request.body, max);
  const capped = new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  try {
    return await capped.formData();
  } catch (e) {
    if (exceeded()) throw new BodyTooLargeError();
    throw e;
  }
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[^\w.\- ؀-ۿ]/g, "_").slice(0, 120) || "project";
}
