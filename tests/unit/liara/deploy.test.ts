import { gunzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { zipSync, type Zippable } from "fflate";
import * as tar from "tar-stream";
import {
  createRelease, createSourceArchive, deploySource, safeEntryPath, SourceArchiveError, uploadSource, watchRelease,
  type WatchEvent,
} from "../../../lib/liara";
import detailFx from "../../fixtures/liara/app-detail.synthetic.json";
import { clientFor, routes } from "./helpers";

const enc = (s: string) => new TextEncoder().encode(s);

async function untar(gz: Buffer): Promise<Record<string, { text: string; mode: number }>> {
  const out: Record<string, { text: string; mode: number }> = {};
  const extract = tar.extract();
  const done = (async () => {
    for await (const entry of extract) {
      const chunks: Buffer[] = [];
      for await (const c of entry) chunks.push(Buffer.from(c as Buffer));
      out[entry.header.name] = { text: Buffer.concat(chunks).toString("utf8"), mode: entry.header.mode ?? 0 };
    }
  })();
  Readable.from(gunzipSync(gz)).pipe(extract);
  await done;
  return out;
}

const codeOf = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as SourceArchiveError).code;

describe("createSourceArchive", () => {
  it("builds a readable .tar.gz from files (modes kept, default mode 0644)", async () => {
    const a = await createSourceArchive({ files: [{ path: "package.json", data: '{"name":"x"}' }, { path: "bin/start.sh", data: "#!/bin/sh", mode: 0o755 }, { path: "src\\index.js", data: enc("1") }] });
    expect(a.fileCount).toBe(3);
    expect(a.size).toBe(a.data.length);
    const files = await untar(a.data);
    expect(Object.keys(files).sort()).toEqual(["bin/start.sh", "package.json", "src/index.js"]);
    expect(files["package.json"]).toEqual({ text: '{"name":"x"}', mode: 0o644 });
    expect(files["bin/start.sh"].mode).toBe(0o755);
  });

  it("rejects path traversal, absolute paths, drive letters and NUL in files input", async () => {
    for (const path of ["../evil.txt", "a/../../evil", "/etc/passwd", "C:\\win\\x", "..\\evil", "ok\0.txt"]) {
      expect(await codeOf(createSourceArchive({ files: [{ path: "ok.txt", data: "1" }, { path, data: "x" }] })), path).toBe("unsafe_path");
    }
    expect(safeEntryPath("./a//b/./c.txt")).toBe("a/b/c.txt");
    expect(safeEntryPath("dir/")).toBe("dir");
  });

  it("rejects the same unsafe names inside a zip", async () => {
    for (const name of ["../evil.txt", "a/../../evil", "/abs.txt"]) {
      const zip = zipSync({ "ok.txt": enc("1"), [name]: enc("x") } as Zippable);
      expect(await codeOf(createSourceArchive({ zip })), name).toBe("unsafe_path");
    }
  });

  it("rejects symlinks (files mode bits and zip unix attributes)", async () => {
    expect(await codeOf(createSourceArchive({ files: [{ path: "link", data: "target", mode: 0o120777 }] }))).toBe("symlink");
    const zip = zipSync({ "ok.txt": enc("1"), link: [enc("/etc/passwd"), { os: 3, attrs: (0o120777 << 16) >>> 0 }] } as Zippable);
    expect(await codeOf(createSourceArchive({ zip }))).toBe("symlink");
    const okZip = zipSync({ "run.sh": [enc("x"), { os: 3, attrs: (0o100755 << 16) >>> 0 }] } as Zippable);
    expect((await createSourceArchive({ zip: okZip })).fileCount).toBe(1);
  });

  it("reads zips, strips a single top-level folder and drops macOS junk", async () => {
    const zip = zipSync({ "proj/package.json": enc("{}"), "proj/src/a.js": enc("a"), "__MACOSX/proj/._a.js": enc("junk"), "proj/.DS_Store": enc("x") });
    const files = await untar((await createSourceArchive({ zip })).data);
    expect(Object.keys(files).sort()).toEqual(["package.json", "src/a.js"]);
    const keep = await untar((await createSourceArchive({ zip }, { stripSingleRoot: false })).data);
    expect(Object.keys(keep)).toContain("proj/package.json");
  });

  it("rejects non-zip data", async () => {
    expect(await codeOf(createSourceArchive({ zip: enc("definitely not a zip file, just text") }))).toBe("invalid_zip");
  });

  it("applies default ignores plus .liaraignore (which wins over .dockerignore)", async () => {
    const mk = (extra: Array<[string, string]>) =>
      createSourceArchive({
        files: [
          { path: "package.json", data: "{}" },
          { path: "node_modules/x/index.js", data: "x" },
          { path: ".git/config", data: "x" },
          { path: "src/app.js", data: "x" },
          { path: "src/app.test.js", data: "x" },
          { path: "logs/a.log", data: "x" },
          { path: "docs/readme.md", data: "x" },
          { path: "keep.log", data: "x" },
          ...extra.map(([path, data]) => ({ path, data })),
        ],
      });
    const base = await untar((await mk([])).data);
    expect(Object.keys(base).sort()).toEqual(["docs/readme.md", "keep.log", "logs/a.log", "package.json", "src/app.js", "src/app.test.js"]);

    const liara = await mk([[".liaraignore", "*.log\n!keep.log\n/docs\nsrc/*.test.js\n# comment\n"], [".dockerignore", "src/\n"]]);
    expect(Object.keys(await untar(liara.data)).sort()).toEqual([".liaraignore", "keep.log", "package.json", "src/app.js"]);
    expect(liara.ignoredCount).toBeGreaterThan(3);

    const docker = await untar((await mk([[".dockerignore", "src/\ndocs/"]])).data);
    expect(Object.keys(docker).sort()).toEqual(["keep.log", "logs/a.log", "package.json"]);
  });

  it("can skip ignoring, and errors when everything is ignored", async () => {
    const all = await createSourceArchive({ files: [{ path: "node_modules/a.js", data: "x" }] }, { applyIgnore: false });
    expect(all.fileCount).toBe(1);
    expect(await codeOf(createSourceArchive({ files: [{ path: "node_modules/a.js", data: "x" }] }))).toBe("empty");
    expect(await codeOf(createSourceArchive({ files: [] }))).toBe("empty");
  });

  it("enforces compressed and uncompressed size limits", async () => {
    const random = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + (i >> 3) * 31) % 251));
    expect(await codeOf(createSourceArchive({ files: [{ path: "a.bin", data: random }] }, { maxBytes: 100 }))).toBe("too_large");
    const big = new Uint8Array(3 * 1024 * 1024);
    expect(await codeOf(createSourceArchive({ files: [{ path: "zeros.bin", data: big }] }, { maxUncompressedBytes: 1024 * 1024 }))).toBe("too_large");
    // zip bomb: tiny zip, big declared size
    const bomb = zipSync({ "zeros.bin": big });
    expect(bomb.length).toBeLessThan(100_000);
    expect(await codeOf(createSourceArchive({ zip: bomb }, { maxUncompressedBytes: 1024 * 1024 }))).toBe("too_large");
    expect(await codeOf(createSourceArchive({ files: [{ path: "a", data: "1" }, { path: "b", data: "1" }] }, { maxFiles: 1 }))).toBe("too_many_files");
  });
});

describe("uploadSource / createRelease / deploySource", () => {
  it("uploads multipart `file` and returns sourceID; 413 and 404 are mapped", async () => {
    const { client, calls } = routes({ "POST /v2/projects/demo/sources": { json: { sourceID: "s1" } } });
    expect(await uploadSource(client, "demo", Buffer.from("gz"))).toBe("s1");
    const form = calls[0].rawBody as FormData;
    expect(form).toBeInstanceOf(FormData);
    const file = form.get("file") as File;
    expect(file.name).toBe("source.tar.gz");
    expect(file.size).toBe(2);
    expect(calls[0].headers["content-type"]).toBeUndefined(); // fetch sets the multipart boundary

    const big = routes({ "POST /v2/projects/demo/sources": { status: 413, json: {} } });
    await expect(uploadSource(big.client, "demo", Buffer.from("x"))).rejects.toMatchObject({ kind: "validation", status: 413 });
    await expect(uploadSource(big.client, "ghost", Buffer.from("x"))).rejects.toMatchObject({ kind: "not_found" });
    expect(big.calls).toHaveLength(2); // no retry
  });

  it("createRelease sends the CLI body for source and image releases", async () => {
    const { client, calls } = routes({ "POST /v2/projects/demo/releases": { json: { releaseID: "rel1" } } });
    expect(await createRelease(client, "demo", { sourceID: "s1", port: 3000, type: "node", message: "m", build: { cache: false, location: "iran" } })).toBe("rel1");
    expect(calls[0].body).toEqual({ sourceID: "s1", port: 3000, type: "node", message: "m", build: { cache: false, location: "iran" } });
    await createRelease(client, "demo", { image: "nginx:1", port: 80, type: "node" });
    expect(calls[1].body).toEqual({ image: "nginx:1", port: 80, type: "docker" });
  });

  it("createRelease validates input and maps 428/400/404/409 without retrying", async () => {
    const { client, calls } = routes({});
    await expect(createRelease(client, "d", { port: 80, type: "node" } as never)).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(createRelease(client, "d", { sourceID: "s", image: "i", port: 80, type: "node" } as never)).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(createRelease(client, "d", { sourceID: "s", port: 0, type: "node" })).rejects.toMatchObject({ code: "invalid_argument" });
    expect(calls).toHaveLength(0);
    for (const [status, body, kind, code] of [
      [428, { data: { code: "max_deployment_count_in_day" } }, "rate_limited", "max_deployment_count_in_day"],
      [400, { statusCode: 400, message: "frozen_project" }, "payment", "frozen_project"],
      [404, {}, "not_found", undefined],
      [409, {}, "conflict", undefined],
    ] as const) {
      const r = routes({ "POST /v2/projects/d/releases": { status, json: body } });
      await expect(createRelease(r.client, "d", { sourceID: "s", port: 80, type: "node" })).rejects.toMatchObject({ kind, code });
      expect(r.calls).toHaveLength(1);
    }
  });

  it("deploySource runs archive -> upload -> release and refuses stopped apps", async () => {
    const r = routes({
      "GET /v1/projects/demo-shop": { json: detailFx },
      "POST /v2/projects/demo-shop/sources": { json: { sourceID: "s1" } },
      "POST /v2/projects/demo-shop/releases": { json: { releaseID: "rel1" } },
    });
    const res = await deploySource(r.client, "demo-shop", { files: [{ path: "package.json", data: "{}" }] }, { port: 3000, type: "node" });
    expect(res).toMatchObject({ releaseID: "rel1", sourceID: "s1", archive: { fileCount: 1 } });
    expect((r.calls[2].body as { sourceID: string }).sourceID).toBe("s1");

    const stopped = routes({ "GET /v1/projects/demo-shop": { json: { project: { ...detailFx.project, scale: 0 } } } });
    await expect(deploySource(stopped.client, "demo-shop", { files: [{ path: "a", data: "1" }] }, { port: 1, type: "node" })).rejects.toMatchObject({ code: "invalid_argument" });
    expect(stopped.calls).toHaveLength(1);
  });
});

describe("watchRelease", () => {
  const fast = { queueIntervalMs: 1, logIntervalMs: 1 };
  async function collect(gen: AsyncGenerator<WatchEvent>) {
    const out: WatchEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  }
  const line = (id: string, text: string, stream = "STDOUT") => ({ _id: id, line: text, stream, createdAt: `2026-01-01T00:00:0${id.slice(1)}Z` });

  it("walks queue -> build logs -> READY, de-duplicating re-served lines", async () => {
    let logPolls = 0;
    const { client, calls } = routes({
      "GET /v1/releases/r1": (() => {
        let n = 0;
        return () => ({ json: { release: { state: "QUEUED", queue: ++n < 3 ? 2 : 0 } } });
      })(),
      "GET /v2/releases/r1/build-logs": () => {
        logPolls++;
        if (logPolls === 1) return { json: { release: { state: "BUILDING" }, buildOutput: [line("b1", "step 1")] } };
        if (logPolls === 2) return { json: { release: { state: "BUILDING" }, buildOutput: [line("b1", "step 1"), line("b2", "step 2")] } };
        if (logPolls === 3) return { json: { release: { state: "DEPLOYING" }, buildOutput: [] } };
        return { json: { release: { state: "READY" }, buildOutput: [] } };
      },
    });
    const events = await collect(watchRelease(client, "r1", fast));
    expect(events.filter((e) => e.kind === "log").map((e) => (e as { line: string }).line)).toEqual(["step 1", "step 2"]);
    expect(events.filter((e) => e.kind === "state").map((e) => (e as { state: string }).state)).toEqual(["QUEUED", "QUEUED", "BUILDING", "DEPLOYING", "READY"]);
    expect(events.filter((e) => e.kind === "state").slice(0, 2)).toEqual([{ kind: "state", state: "QUEUED", queue: 2 }, { kind: "state", state: "QUEUED" }]);
    expect(events.at(-1)).toEqual({ kind: "done", state: "READY", ok: true });
    expect(calls.filter((c) => c.path === "/v1/releases/r1")).toHaveLength(3);
    // cursor: second build-log poll asks since=<createdAt of last line>
    const sinces = calls.filter((c) => c.path.endsWith("build-logs")).map((c) => c.url.searchParams.get("since"));
    expect(sinces[0]).toBeNull();
    expect(sinces[1]).toBe("2026-01-01T00:00:01Z");
  });

  it("ends as failed on the first STDERR build line [CLI]", async () => {
    const { client } = routes({
      "GET /v1/releases/r1": { json: { release: { state: "BUILDING", queue: 0 } } },
      "GET /v2/releases/r1/build-logs": { json: { release: { state: "BUILDING" }, buildOutput: [line("b1", "npm ERR! missing", "STDERR"), line("b2", "later")] } },
    });
    const events = await collect(watchRelease(client, "r1", fast));
    expect(events.map((e) => e.kind)).toEqual(["state", "log", "done"]);
    expect(events.at(-1)).toMatchObject({ state: "FAILED", ok: false, reason: "build_stderr" });
  });

  it.each(["FAILED", "CANCELED", "TIMEDOUT", "UNHEALTHY"])("ends on terminal state %s", async (state) => {
    const { client } = routes({
      "GET /v1/releases/r1": { json: { release: { state: "BUILDING", queue: 0 } } },
      "GET /v2/releases/r1/build-logs": { json: { release: { state, failReason: "disk_not_found x" }, buildOutput: [] } },
    });
    const events = await collect(watchRelease(client, "r1", fast));
    expect(events.at(-1)).toMatchObject({ kind: "done", state, ok: false, failReason: "disk_not_found x" });
  });

  it("stops immediately when the release is already terminal while queued", async () => {
    const { client, calls } = routes({ "GET /v1/releases/r1": { json: { release: { state: "CANCELED", queue: 3 } } } });
    const events = await collect(watchRelease(client, "r1", fast));
    expect(events.at(-1)).toMatchObject({ kind: "done", state: "CANCELED", ok: false });
    expect(calls).toHaveLength(1);
  });

  it("image mode polls only the release endpoint", async () => {
    let n = 0;
    const { client, calls } = routes({ "GET /v1/releases/r1": () => ({ json: { release: { state: ++n < 3 ? "DEPLOYING" : "READY", queue: 0 } } }) });
    const events = await collect(watchRelease(client, "r1", { ...fast, buildLogs: false }));
    expect(events.at(-1)).toMatchObject({ kind: "done", state: "READY", ok: true });
    expect(calls.every((c) => c.path === "/v1/releases/r1")).toBe(true);
  });

  it("tolerates transient failures, but throws on auth errors and after too many failures", async () => {
    let n = 0;
    const flaky = clientFor((c) => {
      if (c.path === "/v1/releases/r1") return { json: { release: { state: "BUILDING", queue: 0 } } };
      return ++n <= 2 ? { status: 502, json: {} } : { json: { release: { state: "READY" }, buildOutput: [] } };
    }, { retries: 0 });
    expect((await collect(watchRelease(flaky.client, "r1", fast))).at(-1)).toMatchObject({ state: "READY", ok: true });

    const auth = routes({ "GET /v1/releases/r1": { status: 401, json: {} } });
    await expect(collect(watchRelease(auth.client, "r1", fast))).rejects.toMatchObject({ kind: "auth" });

    const dead = clientFor(() => ({ status: 503, json: {} }), { retries: 0 });
    await expect(collect(watchRelease(dead.client, "r1", { ...fast, maxConsecutiveErrors: 2 }))).rejects.toMatchObject({ kind: "server" });
  });

  it("gives up with a watch_timeout event and stops on abort", async () => {
    const stuck = routes({ "GET /v1/releases/r1": { json: { release: { state: "QUEUED", queue: 5 } } } });
    const events = await collect(watchRelease(stuck.client, "r1", { ...fast, timeoutMs: 30 }));
    expect(events.at(-1)).toMatchObject({ kind: "done", ok: false, reason: "watch_timeout" });

    const ac = new AbortController();
    const seen: WatchEvent[] = [];
    for await (const e of watchRelease(stuck.client, "r1", { ...fast, signal: ac.signal })) {
      seen.push(e);
      ac.abort();
    }
    expect(seen.map((e) => e.kind)).toEqual(["state"]);
  });
});
