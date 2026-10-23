// Bounded request-body reading for route handlers. Every JSON/text body a route reads goes through here (a quality
// test forbids `request.json()` / `.text()` / `.formData()` / `.arrayBuffer()` / `.blob()` in routes and handlers).
//  - A declared Content-Length is only a FAST reject (413 before a single byte is read); it can be absent (chunked
//    transfer) or wrong, so the running byte count while streaming is what actually enforces the cap.
//  - The source stream is cancelled the moment the cap is crossed, so at most `max` bytes plus one transport chunk
//    are ever held in memory, whatever the client sends.
// Pure Web APIs: usable from route handlers and unit tests alike.

export type CappedBytesResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" | "bad_length" };
export type CappedJsonResult = { ok: true; value: unknown; empty: boolean } | { ok: false; reason: "too_large" | "bad_length" | "bad_json" };

/** HTTP status for a failed read: 413 for an oversize body, 400 for everything else. */
export const bodyFailureStatus = (reason: "too_large" | "bad_length" | "bad_json"): 400 | 413 => (reason === "too_large" ? 413 : 400);

/** Reads at most `max` bytes of the request body. Never buffers more than `max` + one chunk. */
export async function readBodyBytesCapped(request: Request, max: number): Promise<CappedBytesResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const text = declared.trim();
    if (!/^\d{1,15}$/.test(text)) return { ok: false, reason: "bad_length" };
    if (Number(text) > max) {
      await request.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (chunks.length === 1) return { ok: true, bytes: chunks[0] };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Reads a small JSON body with a hard byte cap. An empty body yields `{ ok: true, value: undefined, empty: true }`
 * (the caller decides whether that is acceptable). Invalid UTF-8 or JSON is `bad_json`.
 */
export async function readJsonCapped(request: Request, max: number): Promise<CappedJsonResult> {
  const read = await readBodyBytesCapped(request, max);
  if (!read.ok) return read;
  if (read.bytes.byteLength === 0) return { ok: true, value: undefined, empty: true };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  if (text.trim() === "") return { ok: true, value: undefined, empty: true };
  try {
    return { ok: true, value: JSON.parse(text), empty: false };
  } catch {
    return { ok: false, reason: "bad_json" };
  }
}
