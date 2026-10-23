import { describe, expect, it } from "vitest";
import * as tar from "tar-stream";
import { gzipSync } from "node:zlib";
import { zipSync, strToU8 } from "fflate";
import { LiaraError, SourceArchiveError } from "@/lib/liara";
import { BodyTooLargeError, capStream, readCappedFormData } from "@/lib/create/body-cap";
import { mapDeployError } from "@/lib/create/deploy-errors";
import { checkDeployHeaders, sniffArchive, validateDeployFields } from "@/lib/create/deploy-request";
import { errorKeyFor } from "@/lib/create/errors";
import { MAX_DEPLOY_BODY_BYTES, MAX_JSON_BODY_BYTES, MAX_UPLOAD_BYTES } from "@/lib/create/limits";
import { scanTarGz } from "@/lib/create/tar-scan";
import { createFlow } from "@/lib/i18n/ns/createFlow";

describe("checkDeployHeaders", () => {
  const mp = "multipart/form-data; boundary=x";
  it("accepts multipart / json with a declared length", () => {
    expect(checkDeployHeaders({ contentType: mp, contentLength: "1000" })).toEqual({ ok: true, mode: "multipart" });
    expect(checkDeployHeaders({ contentType: "application/json; charset=utf-8", contentLength: "50" })).toEqual({ ok: true, mode: "json" });
  });
  it("rejects other content types (415)", () => {
    for (const ct of [null, "text/plain", "application/x-www-form-urlencoded"]) {
      expect(checkDeployHeaders({ contentType: ct, contentLength: "10" })).toMatchObject({ ok: false, status: 415 });
    }
  });
  it("requires a numeric Content-Length (411): no unbounded bodies", () => {
    for (const cl of [null, "", "abc", "-1", "1e9"]) expect(checkDeployHeaders({ contentType: mp, contentLength: cl })).toMatchObject({ ok: false, status: 411 });
  });
  it("enforces the size caps (413)", () => {
    expect(checkDeployHeaders({ contentType: mp, contentLength: String(MAX_DEPLOY_BODY_BYTES) })).toMatchObject({ ok: true });
    expect(checkDeployHeaders({ contentType: mp, contentLength: String(MAX_DEPLOY_BODY_BYTES + 1) })).toMatchObject({ ok: false, status: 413, code: "archive_too_large" });
    expect(checkDeployHeaders({ contentType: "application/json", contentLength: String(MAX_JSON_BODY_BYTES + 1) })).toMatchObject({ ok: false, status: 413 });
  });
});

describe("validateDeployFields", () => {
  it("archive: needs platform, port, a named archive within the size cap", () => {
    const ok = validateDeployFields({ source: "archive", port: "3000", type: "node" }, { name: "a.zip", size: 10 });
    expect(ok).toEqual({ ok: true, value: { source: "archive", archive: "zip", port: 3000, type: "node", size: 10 } });
    expect(validateDeployFields({ source: "archive", port: "3000", type: "node" }, { name: "a.tgz", size: 10 })).toMatchObject({ ok: true, value: { archive: "targz" } });
    const bad = (raw: Record<string, unknown>, file?: { name: string; size: number }) => validateDeployFields(raw, file);
    expect(bad({ source: "archive", port: "3000", type: "cobol" }, { name: "a.zip", size: 1 })).toMatchObject({ ok: false, status: 400, code: "bad_fields" });
    expect(bad({ source: "archive", port: "0", type: "node" }, { name: "a.zip", size: 1 })).toMatchObject({ ok: false, code: "bad_fields" });
    expect(bad({ source: "archive", port: "3000", type: "node" })).toMatchObject({ ok: false, code: "bad_fields" });
    expect(bad({ source: "archive", port: "3000", type: "node" }, { name: "a.zip", size: 0 })).toMatchObject({ ok: false, code: "archive_empty" });
    expect(bad({ source: "archive", port: "3000", type: "node" }, { name: "a.zip", size: MAX_UPLOAD_BYTES + 1 })).toMatchObject({ ok: false, status: 413 });
    expect(bad({ source: "archive", port: "3000", type: "node" }, { name: "a.exe", size: 1 })).toMatchObject({ ok: false, code: "archive_type_mismatch" });
  });
  it("image: tagged reference, type is forced to docker", () => {
    expect(validateDeployFields({ source: "image", image: " nginx:1.27 ", port: "80", type: "node" })).toEqual({
      ok: true,
      value: { source: "image", image: "nginx:1.27", port: 80, type: "docker" },
    });
    expect(validateDeployFields({ source: "image", image: "nginx", port: "80" })).toMatchObject({ ok: false, code: "bad_fields" });
    expect(validateDeployFields({ source: "image", image: "x; rm -rf /:1", port: "80" })).toMatchObject({ ok: false });
  });
  it("unknown source and non-string fields are rejected", () => {
    expect(validateDeployFields({ source: "git", port: "80" })).toMatchObject({ ok: false, code: "bad_fields" });
    expect(validateDeployFields({ source: "image", image: { a: 1 }, port: 80 })).toMatchObject({ ok: false });
  });
});

describe("sniffArchive", () => {
  it("recognises zip and gzip by magic bytes", () => {
    expect(sniffArchive(zipSync({ "a.txt": strToU8("hi") }))).toBe("zip");
    expect(sniffArchive(gzipSync(Buffer.from("x")))).toBe("targz");
    expect(sniffArchive(new Uint8Array([0x4d, 0x5a, 0, 0]))).toBeNull();
    expect(sniffArchive(new Uint8Array([]))).toBeNull();
  });
});

describe("error mapping", () => {
  it("maps Liara deploy failures to stable codes", () => {
    const le = (o: ConstructorParameters<typeof LiaraError>[0]) => new LiaraError(o);
    expect(mapDeployError(le({ status: 428, kind: "rate_limited", code: "max_deployment_count_in_day", message: "x" }))).toEqual({ status: 428, code: "deploy_daily_cap" });
    expect(mapDeployError(le({ status: 400, kind: "payment", code: "frozen_project", message: "x" }))).toEqual({ status: 402, code: "frozen_project" });
    expect(mapDeployError(le({ status: 402, kind: "payment", message: "x" }))).toEqual({ status: 402, code: "payment_required" });
    expect(mapDeployError(le({ status: 413, kind: "validation", message: "x" }))).toEqual({ status: 413, code: "upstream_too_large" });
    expect(mapDeployError(le({ status: 409, kind: "conflict", message: "x" }))).toEqual({ status: 409, code: "conflict" });
    expect(mapDeployError(le({ status: 500, kind: "server", message: "x" }))).toBeNull();
    expect(mapDeployError(new Error("boom"))).toBeNull();
  });
  it("maps archive errors", () => {
    expect(mapDeployError(new SourceArchiveError("symlink", "x"))).toEqual({ status: 400, code: "archive_symlink" });
    expect(mapDeployError(new SourceArchiveError("too_large", "x"))).toEqual({ status: 413, code: "archive_too_large" });
    expect(mapDeployError(new SourceArchiveError("unsafe_path", "x"))).toEqual({ status: 400, code: "archive_unsafe" });
  });
  it("every code the server can emit has a Persian message", () => {
    const codes = [
      "archive_too_large", "archive_unsafe", "archive_symlink", "archive_too_many_files", "archive_empty", "archive_invalid", "archive_type_mismatch",
      "unsupported_media_type", "length_required", "bad_fields", "app_stopped", "typed_name_mismatch", "frozen_project", "deploy_daily_cap",
      "payment_required", "upstream_too_large", "germany_builder_not_allowed", "forbidden_origin",
    ];
    for (const code of codes) {
      const key = errorKeyFor({ code }, "deploy");
      expect(createFlow.errors[key], code).toBeTruthy();
      expect(key, code).not.toBe("generic");
    }
  });
  it("falls back to status and distinguishes name conflicts from busy apps", () => {
    expect(errorKeyFor({ status: 409 }, "create")).toBe("nameTaken");
    expect(errorKeyFor({ status: 409 }, "deploy")).toBe("busy");
    expect(errorKeyFor({ status: 402 }, "create")).toBe("paymentRequired");
    expect(errorKeyFor({ status: 428 }, "deploy")).toBe("deployDailyCap");
    expect(errorKeyFor({ status: 413 }, "deploy")).toBe("archiveTooLarge");
    expect(errorKeyFor({ status: 429 }, "create")).toBe("rateLimited");
    expect(errorKeyFor({ status: 0 }, "create")).toBe("network");
    expect(errorKeyFor({ status: 503 }, "create")).toBe("liaraUnavailable");
    expect(errorKeyFor({ status: 418 }, "create")).toBe("generic");
    expect(errorKeyFor({ status: 403, code: "free_plan_platform" }, "create")).toBe("freePlanPlatform");
  });
});

describe("body cap", () => {
  const stream = (chunks: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        c.close();
      },
    });

  it("errors once more than `max` bytes flow through", async () => {
    const reader = capStream(stream([new Uint8Array(6), new Uint8Array(6)]), 10).getReader();
    await reader.read();
    await expect(reader.read()).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("parses multipart within the cap and rejects over it", async () => {
    const form = new FormData();
    form.append("port", "3000");
    form.append("file", new Blob([new Uint8Array(2000)]), "a.zip");
    const req = new Request("http://localhost/x", { method: "POST", body: form });
    const ct = req.headers.get("content-type")!;
    const bytes = new Uint8Array(await req.arrayBuffer());
    const parsed = await readCappedFormData(stream([bytes]), ct, bytes.length);
    expect(parsed.get("port")).toBe("3000");
    expect((parsed.get("file") as File).size).toBe(2000);
    await expect(readCappedFormData(stream([bytes]), ct, bytes.length - 1)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});

async function makeTarGz(entries: Array<{ name: string; data?: string; type?: "file" | "symlink" | "link" | "directory"; linkname?: string }>) {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const done = (async () => {
    for await (const c of pack) chunks.push(Buffer.from(c as Buffer));
  })();
  for (const e of entries) {
    await new Promise<void>((res, rej) =>
      pack.entry({ name: e.name, type: e.type ?? "file", linkname: e.linkname, size: e.type && e.type !== "file" ? 0 : Buffer.byteLength(e.data ?? "") }, e.type && e.type !== "file" ? "" : (e.data ?? ""), (err) => (err ? rej(err) : res())),
    );
  }
  pack.finalize();
  await done;
  return gzipSync(Buffer.concat(chunks));
}

describe("scanTarGz", () => {
  it("accepts a normal project", async () => {
    const data = await makeTarGz([{ name: "app/", type: "directory" }, { name: "app/index.js", data: "x" }, { name: "package.json", data: "{}" }]);
    await expect(scanTarGz(data)).resolves.toMatchObject({ files: 2 });
  });
  it("rejects traversal, absolute paths, symlinks and hard links", async () => {
    await expect(scanTarGz(await makeTarGz([{ name: "../evil", data: "x" }]))).rejects.toMatchObject({ code: "unsafe_path" });
    await expect(scanTarGz(await makeTarGz([{ name: "/etc/passwd", data: "x" }]))).rejects.toMatchObject({ code: "unsafe_path" });
    await expect(scanTarGz(await makeTarGz([{ name: "ok.txt", data: "x" }, { name: "l", type: "symlink", linkname: "/etc" }]))).rejects.toMatchObject({ code: "symlink" });
    await expect(scanTarGz(await makeTarGz([{ name: "ok.txt", data: "x" }, { name: "h", type: "link", linkname: "ok.txt" }]))).rejects.toMatchObject({ code: "symlink" });
  });
  it("bounds file count and uncompressed size; rejects empty and garbage", async () => {
    const many = await makeTarGz([{ name: "a", data: "1" }, { name: "b", data: "2" }, { name: "c", data: "3" }]);
    await expect(scanTarGz(many, { maxFiles: 2 })).rejects.toMatchObject({ code: "too_many_files" });
    await expect(scanTarGz(await makeTarGz([{ name: "big", data: "x".repeat(5000) }]), { maxUncompressedBytes: 1000 })).rejects.toMatchObject({ code: "too_large" });
    await expect(scanTarGz(await makeTarGz([]))).rejects.toMatchObject({ code: "empty" });
    await expect(scanTarGz(gzipSync(Buffer.from("not a tar file at all".repeat(40))))).rejects.toBeInstanceOf(SourceArchiveError);
    await expect(scanTarGz(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(SourceArchiveError);
  });
});
