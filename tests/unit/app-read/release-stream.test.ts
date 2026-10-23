// Synthetic Liara responses; verifies the STDERR-doesn't-mean-failed behaviour of streamRelease.
import { describe, expect, it } from "vitest";
import { streamRelease } from "../../../lib/service/app-read/release-stream";
import type { ReleaseStreamEvent } from "../../../lib/service/app-read/types";
import { routes } from "../liara/helpers";

async function collect(gen: AsyncGenerator<ReleaseStreamEvent>) {
  const out: ReleaseStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("streamRelease (synthetic)", () => {
  it("keeps following after a harmless STDERR line and ends on the real terminal state", async () => {
    let buildCalls = 0;
    const { client } = routes({
      "GET /v1/releases/r1": { json: { release: { _id: "r1", state: "DEPLOYING", queue: 0 } } },
      "GET /v2/releases/r1/build-logs": () => {
        buildCalls++;
        if (buildCalls === 1) {
          return { json: { release: { _id: "r1", state: "DEPLOYING" }, buildOutput: [
            { _id: "l1", line: "npm WARN deprecated x password=SYNTH-PW-1", stream: "STDERR", createdAt: "2026-01-01T00:00:01Z" },
          ] } };
        }
        return { json: { release: { _id: "r1", state: "READY" }, buildOutput: [
          { _id: "l2", line: "Build done", stream: "STDOUT", createdAt: "2026-01-01T00:00:02Z" },
        ] } };
      },
    });
    const events = await collect(streamRelease(client, "r1", { followIntervalMs: 1, timeoutMs: 10_000 }));
    const logs = events.filter((e) => e.kind === "log");
    expect(logs.map((e) => (e.kind === "log" ? e.line : ""))).toEqual(["npm WARN deprecated x password=[REDACTED]", "Build done"]);
    expect(JSON.stringify(events)).not.toContain("SYNTH-PW-1");
    expect(events.at(-1)).toMatchObject({ kind: "done", state: "READY", ok: true });
    expect(events.filter((e) => e.kind === "done")).toHaveLength(1);
  });

  it("reports FAILED with a masked failReason when the release really failed", async () => {
    const { client } = routes({
      "GET /v1/releases/r2": { json: { release: { _id: "r2", state: "FAILED", failReason: "bad token=SYNTH-T-999" } } },
    });
    const events = await collect(streamRelease(client, "r2", { timeoutMs: 5000 }));
    expect(events.at(-1)).toMatchObject({ kind: "done", state: "FAILED", ok: false });
    expect(JSON.stringify(events)).not.toContain("SYNTH-T-999");
  });
});
