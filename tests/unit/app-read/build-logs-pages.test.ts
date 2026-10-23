// One-shot build logs read every 20-line page (live Liara 2026-10-23), strip ANSI, split multi-line entries and
// still mask known secrets on later pages. Synthetic data.
import { beforeEach, describe, expect, it } from "vitest";
import { readBuildLogs } from "../../../lib/service/app-read/build-logs";
import { buildLineLevel, splitBuildLine } from "../../../lib/service/app-read/build-log-text";
import { createRedactor } from "../../../lib/security/redact";
import { clearLogRedactors } from "../../../lib/service/app-read/known-secrets";
import { routes } from "../liara/helpers";

const ENV_VALUE = "SYNTH-env-value-Zq81xKd203mn77";
const NPM_ERROR = "\u001b[91mnpm error code ETARGET\nnpm error notarget No matching version found for express@^99.0.0.\n\u001b[0m";
const at = (i: number) => new Date(Date.UTC(2026, 9, 23, 3, 0, i)).toISOString();

function entries(lines: string[]) {
  return lines.map((line, i) => ({ _id: `b${i}`, line, stream: "STDOUT", releaseID: "r1", createdAt: at(i) }));
}

/** 20 lines per call; `?since` is inclusive (the boundary line repeats), like live Liara. `failPage` answers 500 on that call. */
function paged(all: ReturnType<typeof entries>, failPage?: number) {
  let n = 0;
  return routes(
    {
      "GET /v2/releases/r1/build-logs": (c) => {
        if (++n === failPage) return { status: 500, json: { message: "boom" } };
        const since = c.url.searchParams.get("since");
        const from = since ? all.filter((l) => Date.parse(l.createdAt) >= Date.parse(since)) : all;
        return { json: { release: { _id: "r1", state: "FAILED", failReason: "npm install failed" }, buildOutput: from.slice(0, 20) } };
      },
    },
    { retries: 0 },
  );
}

const steps = (n: number) => Array.from({ length: n }, (_, i) => `Step ${i + 1}`);
const red = createRedactor();

beforeEach(() => clearLogRedactors());

describe("one-shot build logs: all pages", () => {
  it("reads two pages (30 lines), the last line is the failure, not partial", async () => {
    const all = entries([...steps(29), "The command '/bin/sh -c npm install' returned a non-zero code: 1"]);
    const { client, calls } = paged(all);
    const out = await readBuildLogs(client, "r1", red);
    expect(out.lines).toHaveLength(30);
    expect(out.lines.at(-1)?.line).toContain("returned a non-zero code: 1");
    expect(out.partial).toBe(false);
    expect(out.truncated).toBe(false);
    expect(calls[0].url.searchParams.get("since")).toBeNull();
    expect(calls[1].url.searchParams.get("since")).toBe(at(19));
    expect(out.release?.state).toBe("FAILED");
  });

  it("a failing second page keeps page 1 and sets partial; a failing first page throws", async () => {
    const all = entries(steps(30));
    const out = await readBuildLogs(paged(all, 2).client, "r1", red);
    expect(out.lines).toHaveLength(20);
    expect(out.partial).toBe(true);
    await expect(readBuildLogs(paged(all, 1).client, "r1", red)).rejects.toBeTruthy();
  });

  it("strips ANSI and splits a multi-line STDOUT entry into lines that keep stream and time", async () => {
    const out = await readBuildLogs(paged(entries([...steps(20), NPM_ERROR])).client, "r1", red);
    const tail = out.lines.slice(20);
    expect(tail.map((l) => l.line)).toEqual(["npm error code ETARGET", "npm error notarget No matching version found for express@^99.0.0."]);
    expect(tail.every((l) => l.stream === "STDOUT" && l.createdAt === at(20))).toBe(true);
    expect(JSON.stringify(out)).not.toContain("\u001b");
  });

  it("masks a known secret printed on page 2 (also inside an ANSI-coloured multi-line entry)", async () => {
    const secretEntry = `\u001b[91mnpm error connecting to ${ENV_VALUE}\nnpm error done\u001b[0m`;
    const { client } = routes(
      {
        "GET /v1/projects/shop": { json: { project: { project_id: "shop", type: "node", envs: [{ key: "DB_DSN", value: ENV_VALUE }] } } },
        "GET /v2/releases/r1/build-logs": (c) => {
          const all = entries([...steps(20), secretEntry]);
          const since = c.url.searchParams.get("since");
          const from = since ? all.filter((l) => Date.parse(l.createdAt) >= Date.parse(since)) : all;
          return { json: { release: { _id: "r1", state: "FAILED" }, buildOutput: from.slice(0, 20) } };
        },
      },
      { retries: 0 },
    );
    const { buildLogRedactor } = await import("../../../lib/service/app-read/build-logs");
    const redactor = await buildLogRedactor(client, { accountId: "acct_pages" }, "shop");
    const out = await readBuildLogs(client, "r1", redactor);
    expect(JSON.stringify(out)).not.toContain(ENV_VALUE);
    expect(out.lines.at(-2)?.line).toContain("«redacted»");
    expect(out.lines.at(-1)?.line).toBe("npm error done");
  });
});

describe("build line text helpers", () => {
  it("splitBuildLine: strips ANSI, splits, drops trailing blanks, keeps an empty entry as one blank line", () => {
    expect(splitBuildLine(NPM_ERROR)).toEqual(["npm error code ETARGET", "npm error notarget No matching version found for express@^99.0.0."]);
    expect(splitBuildLine("a\r\n\r\nb\n\n")).toEqual(["a", "", "b"]);
    expect(splitBuildLine("")).toEqual([""]);
  });

  it("buildLineLevel highlights npm error / ERR! / Error: lines and warnings, not plain steps", () => {
    for (const l of ["npm error code ETARGET", "npm ERR! code E404", "Error: Cannot find module 'x'"]) {
      expect(buildLineLevel(l), l).toBe("error");
    }
    expect(buildLineLevel("npm warn deprecated foo@1")).toBe("warn");
    expect(buildLineLevel("Step 3/24 : COPY . .")).toBeUndefined();
    expect(buildLineLevel("> Running npm install...")).toBeUndefined();
  });
});
