// The deploy route with the session/Liara layers replaced by test doubles (synthetic, no network).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";

const calls = vi.hoisted(() => ({ getApp: vi.fn(), uploadSource: vi.fn(), createRelease: vi.fn(), audit: vi.fn(), account: { id: "acc-1" } }));

vi.mock("@/lib/server/liara", async (orig) => {
  const real = await orig<typeof import("@/lib/server/liara")>();
  return {
    ...real,
    api: (handler: (ctx: unknown, ...rest: unknown[]) => Promise<Response>) => (request: Request, ...rest: unknown[]) =>
      handler({ session: { token: "t", accountId: calls.account.id }, liara: {}, request }, ...rest).catch((e) => real.toErrorResponse(e)),
  };
});
vi.mock("@/lib/liara", async (orig) => {
  const real = await orig<typeof import("@/lib/liara")>();
  return { ...real, getApp: calls.getApp, uploadSource: calls.uploadSource, createRelease: calls.createRelease };
});
vi.mock("@/lib/security", async (orig) => {
  const real = await orig<typeof import("@/lib/security")>();
  return { ...real, getDefaultStore: () => ({}), appendAudit: calls.audit };
});

import { POST } from "@/app/api/apps/[name]/deploy/route";

const ctx = (name = "shop-1") => ({ params: Promise.resolve({ name }) });
const zipBytes = () => zipSync({ "index.js": strToU8("console.log(1)"), "package.json": strToU8("{}") });

// A real HTTP server sets Content-Length for the browser's multipart body; a bare Request object does not.
async function withLength(form: FormData, headers: Record<string, string>): Promise<Request> {
  const probe = new Response(form);
  const body = new Uint8Array(await probe.arrayBuffer());
  return new Request("http://localhost/api/apps/shop-1/deploy", {
    method: "POST",
    body,
    headers: { "content-type": probe.headers.get("content-type")!, "content-length": String(body.length), ...headers },
  });
}

async function multipart(opts: { typed?: string | null; file?: Uint8Array | null; fileName?: string; port?: string; type?: string } = {}) {
  const form = new FormData();
  form.append("source", "archive");
  form.append("port", opts.port ?? "3000");
  form.append("type", opts.type ?? "node");
  const bytes = opts.file === undefined ? zipBytes() : opts.file;
  if (bytes) form.append("file", new Blob([Buffer.from(bytes)]), opts.fileName ?? "src.zip");
  const headers: Record<string, string> = {};
  if (opts.typed !== null) headers["x-typed-name"] = opts.typed ?? "shop-1";
  return withLength(form, headers);
}
const json = (body: unknown, typed: string | null = "shop-1") => {
  const text = JSON.stringify(body);
  return new Request("http://localhost/api/apps/shop-1/deploy", {
    method: "POST",
    body: text,
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...(typed !== null ? { "x-typed-name": typed } : {}) },
  });
};
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  calls.getApp.mockReset().mockResolvedValue({ scale: 1 });
  calls.uploadSource.mockReset().mockResolvedValue("src-1");
  calls.createRelease.mockReset().mockResolvedValue("rel-1");
  calls.audit.mockReset().mockResolvedValue(undefined);
  calls.account.id = `acc-${Math.random().toString(36).slice(2)}`; // fresh rate-limit bucket per test
});

describe("POST /api/apps/[name]/deploy", () => {
  it("uploads a zip, creates the release and audits without file contents", async () => {
    const res = await POST(await multipart(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releaseId: "rel-1" });
    expect(calls.uploadSource).toHaveBeenCalledTimes(1);
    const archive = calls.uploadSource.mock.calls[0][2] as Uint8Array;
    expect(archive[0]).toBe(0x1f); // repacked as .tar.gz
    expect(calls.createRelease).toHaveBeenCalledWith(expect.anything(), "shop-1", { sourceID: "src-1", port: 3000, type: "node" });
    expect(calls.audit).toHaveBeenCalledTimes(1);
    const entry = calls.audit.mock.calls[0][2];
    expect(entry).toMatchObject({ actor: "user", action: "deploy.release", target: { kind: "app", name: "shop-1" }, result: "ok" });
    expect(entry.paramsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("console.log");
  });

  it("deploys an image via JSON", async () => {
    const res = await POST(json({ source: "image", image: "nginx:1.27", port: "80" }), ctx());
    expect(res.status).toBe(200);
    expect(calls.createRelease).toHaveBeenCalledWith(expect.anything(), "shop-1", { image: "nginx:1.27", port: 80, type: "docker" });
    expect(calls.uploadSource).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong typed name before touching the body or Liara", async () => {
    for (const typed of [null, "", "shop-2", " shop-1x"]) {
      const res = await POST(await multipart({ typed }), ctx());
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("typed_name_mismatch");
    }
    expect(calls.getApp).not.toHaveBeenCalled();
    expect(calls.uploadSource).not.toHaveBeenCalled();
    expect(calls.audit.mock.calls.every((c) => c[2].result === "denied")).toBe(true);
  });

  it("rate limits to 5 per minute per account (429 + retry hint)", async () => {
    for (let i = 0; i < 5; i++) expect((await POST(json({ source: "image", image: "nginx:1", port: "80" }), ctx())).status).toBe(200);
    const res = await POST(json({ source: "image", image: "nginx:1", port: "80" }), ctx());
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; retryAfterSec?: number } };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.retryAfterSec).toBeGreaterThan(0);
  });

  it("enforces content-type and a declared length (415 / 411 / 413)", async () => {
    const wrongType = new Request("http://localhost/x", { method: "POST", body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded", "x-typed-name": "shop-1" } });
    expect((await POST(wrongType, ctx())).status).toBe(415);
    const noLength = new Request("http://localhost/x", { method: "POST", body: "x", headers: { "content-type": "multipart/form-data; boundary=a", "x-typed-name": "shop-1" } });
    expect((await POST(noLength, ctx())).status).toBe(411);
    const forged = new Request("http://localhost/x", { method: "POST", body: "x", headers: { "content-type": "multipart/form-data; boundary=a", "content-length": String(300 * 1024 * 1024), "x-typed-name": "shop-1" } });
    const res = await POST(forged, ctx());
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("archive_too_large");
  });

  it("rejects bad fields, wrong extension, and bytes that do not match the extension", async () => {
    expect(await errorCode(await POST(await multipart({ port: "99999" }), ctx()))).toBe("bad_fields");
    expect(await errorCode(await POST(await multipart({ type: "cobol" }), ctx()))).toBe("bad_fields");
    expect(await errorCode(await POST(await multipart({ file: null }), ctx()))).toBe("bad_fields");
    expect(await errorCode(await POST(await multipart({ fileName: "src.exe" }), ctx()))).toBe("archive_type_mismatch");
    expect(await errorCode(await POST(await multipart({ file: new Uint8Array([0x4d, 0x5a, 1, 2, 3]) }), ctx()))).toBe("archive_type_mismatch");
    expect(calls.uploadSource).not.toHaveBeenCalled();
  });

  it("refuses unsafe zips (path traversal) and never uploads them", async () => {
    const evil = zipSync({ "../../etc/cron.d/x": strToU8("boom") });
    const res = await POST(await multipart({ file: evil }), ctx());
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("archive_unsafe");
    expect(calls.uploadSource).not.toHaveBeenCalled();
    expect(calls.audit.mock.calls.at(-1)?.[2]).toMatchObject({ result: "error", detail: "archive_unsafe" });
  });

  it("maps a stopped app, 404, daily cap, frozen project", async () => {
    calls.getApp.mockResolvedValueOnce({ scale: 0 });
    const stopped = await POST(await multipart(), ctx());
    expect(stopped.status).toBe(409);
    expect(await errorCode(stopped)).toBe("app_stopped");

    const { LiaraError } = await import("@/lib/liara");
    calls.createRelease.mockRejectedValueOnce(new LiaraError({ status: 428, kind: "rate_limited", code: "max_deployment_count_in_day", message: "x" }));
    const cap = await POST(await multipart(), ctx());
    expect(cap.status).toBe(428);
    expect(await errorCode(cap)).toBe("deploy_daily_cap");

    calls.createRelease.mockRejectedValueOnce(new LiaraError({ status: 400, kind: "payment", code: "frozen_project", message: "x" }));
    const frozen = await POST(await multipart(), ctx());
    expect(frozen.status).toBe(402);
    expect(await errorCode(frozen)).toBe("frozen_project");

    calls.getApp.mockRejectedValueOnce(new LiaraError({ status: 404, kind: "not_found", message: "x" }));
    expect((await POST(await multipart(), ctx())).status).toBe(404);
  });

  it("rejects invalid app names in the path", async () => {
    const res = await POST(await multipart(), ctx("bad name!"));
    expect(res.status).toBe(400);
    expect(calls.getApp).not.toHaveBeenCalled();
  });
});
