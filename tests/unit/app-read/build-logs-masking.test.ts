// Browser build-log views mask the app's own env values (known secrets) when `?app=` is given. Synthetic data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appParam, buildLogRedactor, readBuildLogs } from "../../../lib/service/app-read/build-logs";
import { clearLogRedactors } from "../../../lib/service/app-read/known-secrets";
import { streamRelease } from "../../../lib/service/app-read/release-stream";
import type { ReleaseStreamEvent } from "../../../lib/service/app-read/types";
import { routes } from "../liara/helpers";

const ENV_VALUE = "SYNTH-env-value-Zq81xKd203mn77";
const B64 = Buffer.from(ENV_VALUE).toString("base64");
const scope = { accountId: "acct_build_logs" };

/** A release that is still building: the first build-log read has a STDERR line, the second a terminal FAILED. */
function buildingLiara() {
  let n = 0;
  return routes({
    "GET /v1/projects/shop": { json: { project: { project_id: "shop", type: "node", envs: [{ key: "DB_DSN", value: ENV_VALUE }] } } },
    "GET /v1/releases/r1": { json: { release: { _id: "r1", state: "DEPLOYING", queue: 0 } } },
    "GET /v2/releases/r1/build-logs": () =>
      ++n === 1
        ? { json: { release: { _id: "r1", state: "DEPLOYING" }, buildOutput: [
            { _id: "l1", line: `Step 3: connecting to ${ENV_VALUE} ...`, stream: "STDOUT", createdAt: "2026-01-01T00:00:01Z" },
            { _id: "l2", line: `warn: ${B64}`, stream: "STDERR", createdAt: "2026-01-01T00:00:02Z" },
          ] } }
        : { json: { release: { _id: "r1", state: "FAILED", failReason: `build failed using ${ENV_VALUE}` }, buildOutput: [] } },
  });
}

function liara(onEnvRead?: () => void) {
  return routes({
    "GET /v1/projects/shop": () => {
      onEnvRead?.();
      return { json: { project: { project_id: "shop", type: "node", envs: [{ key: "DB_DSN", value: ENV_VALUE }, { key: "PORT", value: "3000" }] } } };
    },
    "GET /v2/releases/r1/build-logs": {
      json: {
        release: { _id: "r1", state: "FAILED", failReason: `build failed using ${ENV_VALUE}` },
        buildOutput: [
          { _id: "l1", line: `Step 3: connecting to ${ENV_VALUE} ...`, stream: "STDOUT", createdAt: "2026-01-01T00:00:01Z" },
          { _id: "l2", line: `debug b64=${B64}`, stream: "STDOUT", createdAt: "2026-01-01T00:00:02Z" },
          { _id: "l3", line: "plain line, nothing secret", stream: "STDERR", createdAt: "2026-01-01T00:00:03Z" },
        ],
      },
    },
    "GET /v1/releases/r1": { json: { release: { _id: "r1", state: "FAILED", failReason: `bad ${ENV_VALUE}` } } },
  });
}

beforeEach(() => clearLogRedactors());

describe("?app= param", () => {
  it("absent -> no app; safe name -> app; anything else -> invalid (400 in the routes)", () => {
    expect(appParam(new URLSearchParams(""))).toEqual({});
    expect(appParam(new URLSearchParams("app="))).toEqual({});
    expect(appParam(new URLSearchParams("app=my-shop.v2"))).toEqual({ app: "my-shop.v2" });
    for (const bad of ["../x", "a/b", "a b", "-lead", "x".repeat(101), "a?b=c"]) {
      expect(appParam(new URLSearchParams({ app: bad })), bad).toEqual({ invalid: true });
    }
  });
});

describe("one-shot build logs", () => {
  it("with app: an env value printed in a build line (also base64) and in failReason is masked; the value is never returned", async () => {
    const { client } = liara();
    const redactor = await buildLogRedactor(client, scope, "shop");
    const out = await readBuildLogs(client, "r1", redactor);
    const body = JSON.stringify(out);
    expect(body).not.toContain(ENV_VALUE);
    expect(body).not.toContain(B64);
    expect(out.lines[0].line).toContain("«redacted»");
    expect(out.lines[0].line).toContain("Step 3: connecting to");
    expect(out.lines[2]).toMatchObject({ line: "plain line, nothing secret", stream: "STDERR" });
    expect(out.release?.failReason).not.toContain(ENV_VALUE);
  });

  it("without app: pattern-only fallback (no env read); the env value is not known, so a bare value stays", async () => {
    const { client, calls } = liara();
    const redactor = await buildLogRedactor(client, scope, undefined);
    const out = await readBuildLogs(client, "r1", redactor);
    expect(calls.some((c) => c.path === "/v1/projects/shop")).toBe(false);
    expect(out.lines[0].line).toContain(ENV_VALUE); // documents WHY the UI passes `app`
  });

  it("env values are cached 60 s per account+app (one env read for two views); unreadable env falls back to patterns", async () => {
    let reads = 0;
    const { client } = liara(() => reads++);
    await buildLogRedactor(client, scope, "shop");
    await buildLogRedactor(client, scope, "shop");
    expect(reads).toBe(1);
    const failing = routes({ "GET /v2/releases/r1/build-logs": { json: { buildOutput: [{ _id: "l", line: `x ${ENV_VALUE}`, stream: "STDOUT" }] } } });
    const red = await buildLogRedactor(failing.client, { accountId: "acct_other" }, "shop"); // 404 on the env read
    const out = await readBuildLogs(failing.client, "r1", red);
    expect(out.lines).toHaveLength(1);
  });
});

describe("SSE build stream", () => {
  async function collect(gen: AsyncGenerator<ReleaseStreamEvent>) {
    const out: ReleaseStreamEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  }

  it("with a redactor an env value in a log line and in failReason is masked", async () => {
    const { client } = buildingLiara();
    const redactor = await buildLogRedactor(client, scope, "shop");
    const events = await collect(streamRelease(client, "r1", { redactor, followIntervalMs: 1, timeoutMs: 5000 }));
    expect(events.some((e) => e.kind === "log")).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: "done", ok: false });
    expect(JSON.stringify(events)).not.toContain(ENV_VALUE);
    expect(JSON.stringify(events)).not.toContain(B64);
  });

  it("without a redactor the bare value is still pattern-only (what the `app` param fixes)", async () => {
    const { client } = buildingLiara();
    const events = await collect(streamRelease(client, "r1", { followIntervalMs: 1, timeoutMs: 5000 }));
    expect(JSON.stringify(events)).toContain(ENV_VALUE);
  });
});

describe("the browser always passes ?app=", () => {
  it("BuildLogPanel adds it to both the SSE and the one-shot URL, and both callers supply appName", () => {
    const root = join(__dirname, "..", "..", "..");
    const panel = readFileSync(join(root, "components/service/app/releases/build-log-panel.tsx"), "utf8");
    expect(panel).toMatch(/\/stream\?app=\$\{encodeURIComponent\(appName\)\}/);
    expect(panel).toMatch(/\/build-logs\?app=\$\{encodeURIComponent\(appName\)\}/);
    for (const f of ["components/service/app/releases/release-detail.tsx", "components/create/deploy-progress.tsx"]) {
      expect(readFileSync(join(root, f), "utf8"), f).toMatch(/<BuildLogPanel [^>]*appName=\{appName\}/);
    }
  });
});
