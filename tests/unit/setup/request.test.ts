import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyTooLargeError, checkContentLength, classifyContentType, limitStream, readBodyCapped, readFormDataCapped, sanitizeFileName } from "@/lib/setup/request";
import { MAX_PER_ACCOUNT, SOURCE_TTL_MS, deleteSource, getSource, putSource } from "@/lib/setup/source-store";
import { zipOf } from "./helpers";

describe("content type", () => {
  it("accepts only multipart and json", () => {
    expect(classifyContentType("multipart/form-data; boundary=x")).toBe("multipart");
    expect(classifyContentType("Application/JSON; charset=utf-8")).toBe("json");
    for (const bad of [null, "", "text/plain", "application/zip", "application/x-www-form-urlencoded"]) expect(classifyContentType(bad)).toBeNull();
  });
});

describe("declared length", () => {
  it("rejects over-limit and malformed lengths, allows absent", () => {
    expect(checkContentLength("100", 1000)).toEqual({ ok: true });
    expect(checkContentLength("1001", 1000)).toEqual({ ok: false, status: 413 });
    expect(checkContentLength("-5", 1000)).toEqual({ ok: false, status: 400 });
    expect(checkContentLength("abc", 1000)).toEqual({ ok: false, status: 400 });
    expect(checkContentLength(null, 1000)).toEqual({ ok: true });
  });
});

const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(x);
      c.close();
    },
  });

describe("size cap enforced while streaming", () => {
  it("limitStream errors the stream as soon as the cap is crossed", async () => {
    const { stream, exceeded } = limitStream(streamOf(new Uint8Array(60), new Uint8Array(60)), 100);
    const reader = stream.getReader();
    await reader.read();
    await expect(reader.read()).rejects.toBeDefined();
    expect(exceeded()).toBe(true);
  });

  it("readBodyCapped returns bytes within the cap and throws BodyTooLargeError beyond it", async () => {
    const ok = new Request("http://x.invalid", { method: "POST", body: new Uint8Array(50) });
    expect((await readBodyCapped(ok, 100)).byteLength).toBe(50);
    const big = new Request("http://x.invalid", { method: "POST", body: new Uint8Array(500) });
    await expect(readBodyCapped(big, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("a lying Content-Length cannot get around the cap (the stream is what counts)", async () => {
    const req = new Request("http://x.invalid", { method: "POST", body: new Uint8Array(500), headers: { "content-length": "10" } });
    await expect(readBodyCapped(req, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("readFormDataCapped parses a small upload and rejects an oversized one", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(2000)], "p.zip"));
    const req = () => new Request("http://x.invalid", { method: "POST", body: form });
    const parsed = await readFormDataCapped(req(), 100_000);
    expect((parsed.get("file") as File).size).toBe(2000);
    await expect(readFormDataCapped(req(), 500)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});

describe("file names", () => {
  it("drops directories and odd characters", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\x\\my project.zip")).toBe("my project.zip");
    expect(sanitizeFileName("<script>.zip")).toBe("_script_.zip");
    expect(sanitizeFileName("")).toBe("project");
  });
});

describe("source store", () => {
  afterEach(() => vi.useRealTimers());
  const bytes = zipOf({ "a.txt": "hello" });

  it("round-trips per account and isolates accounts", async () => {
    const { ref } = await putSource("acct_a", bytes, "p.zip");
    expect(ref).toMatch(/^[0-9a-f]{32}$/);
    const got = await getSource("acct_a", ref);
    expect(got).toMatchObject({ ref, fileName: "p.zip", size: bytes.byteLength });
    expect(got).not.toHaveProperty("accountId");
    expect(await getSource("acct_b", ref)).toBeNull();
    await deleteSource("acct_b", ref);
    expect(await getSource("acct_a", ref)).not.toBeNull();
    await deleteSource("acct_a", ref);
    expect(await getSource("acct_a", ref)).toBeNull();
  });

  it("keeps at most a few sources per account (oldest evicted)", async () => {
    const refs: string[] = [];
    for (let i = 0; i < MAX_PER_ACCOUNT + 1; i++) refs.push((await putSource("acct_cap", bytes, `p${i}.zip`)).ref);
    expect(await getSource("acct_cap", refs[0])).toBeNull();
    expect(await getSource("acct_cap", refs[refs.length - 1])).not.toBeNull();
  });

  it("entries expire", async () => {
    vi.useFakeTimers();
    const { ref } = await putSource("acct_ttl", bytes, "p.zip");
    vi.advanceTimersByTime(SOURCE_TTL_MS + 1000);
    expect(await getSource("acct_ttl", ref)).toBeNull();
  });
});
