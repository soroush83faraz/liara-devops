// Hard cap for request bodies: a stream that errors the moment more than `max` bytes flow through it,
// so `Response.formData()` never buffers an unbounded upload even if Content-Length lied.

export class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLargeError";
  }
}

export function capStream(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) {
          controller.error(new BodyTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Parses multipart form data with a hard byte cap. Throws BodyTooLargeError when exceeded. */
export async function readCappedFormData(body: ReadableStream<Uint8Array> | null, contentType: string, max: number): Promise<FormData> {
  if (!body) throw new TypeError("empty body");
  try {
    return await new Response(capStream(body, max), { headers: { "content-type": contentType } }).formData();
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw e;
    // undici wraps stream errors; look at the cause chain.
    for (let c: unknown = e; c; c = (c as { cause?: unknown }).cause) if (c instanceof BodyTooLargeError) throw c;
    throw e;
  }
}
