import { describe, expect, it } from "vitest";
import { getBuildLogs, getRuntimeLogs, parseRuntimeLogs, tailRuntimeLogs, type LogLine } from "../../../lib/liara";
import v2Fx from "../../fixtures/liara/runtime-logs-v2.synthetic.json";
import v1Fx from "../../fixtures/liara/runtime-logs-v1.synthetic.json";
import buildFx from "../../fixtures/liara/build-logs.synthetic.json";
import { clientFor, routes } from "./helpers";

describe("parseRuntimeLogs", () => {
  it("parses the v2 Loki-like shape, sorts globally and keeps release ids + streams", () => {
    const lines = parseRuntimeLogs(v2Fx);
    expect(lines.map((l) => l.message)).toEqual(["old release line", "Server listening on 3000", "Error: connect ECONNREFUSED 10.0.0.5:5432"]);
    expect(lines[1]).toEqual({ ts: "2026-01-03T08:46:40.000Z", tsNs: "1767430000000000000", stream: "stdout", message: "Server listening on 3000", releaseId: "r2" });
    expect(lines[2].stream).toBe("stderr");
    expect(lines[0].releaseId).toBe("r1");
  });

  it("parses the legacy v1 array [{type,datetime,message}]", () => {
    const lines = parseRuntimeLogs(v1Fx.logs);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ message: "hello", stream: "stdout", ts: "2026-01-03T09:10:00.000Z", tsNs: "1767431400000000000" });
    expect(lines[1]).toMatchObject({ message: "boom", stream: "stderr", ts: "2026-01-03T09:10:01.500Z" });
  });

  it("parses plain strings, multi-line text and string values without JSON", () => {
    expect(parseRuntimeLogs("a\nb\r\n\nc").map((l) => l.message)).toEqual(["a", "b", "c"]);
    expect(parseRuntimeLogs(["x", "y"]).map((l) => l.message)).toEqual(["x", "y"]);
    const raw = { data: [{ metaData: {}, values: [["1700000000000000000", "plain text line"], ["1700000001000000000", "{not json"], ["1700000002000000000", '"a json string"']] }] };
    const lines = parseRuntimeLogs(raw);
    expect(lines.map((l) => l.message)).toEqual(["plain text line", "{not json", '"a json string"']);
    expect(lines.every((l) => l.stream === "unknown")).toBe(true);
  });

  it("never throws on malformed lines/entries and keeps the good ones", () => {
    const raw = {
      data: [
        null,
        { values: "nope" },
        { metaData: null, values: [null, 5, ["only-one"], ["abc", JSON.stringify({ _entry: "bad ts" })], ["1700000000000000000", JSON.stringify({ _entry: "ok", type: "STDERR" })], ["1700000000000000001", 42 as never]] },
      ],
    };
    const lines = parseRuntimeLogs(raw);
    expect(lines.map((l) => l.message)).toEqual(["bad ts", "ok"]);
    expect(lines[0].tsNs).toBe("0");
    expect(lines[0].ts).toBe("1970-01-01T00:00:00.000Z");
    expect(lines[1].stream).toBe("stderr");
    for (const junk of [undefined, null, 42, true, {}, [], [null, 1, { a: 1 }], { data: "x" }]) expect(parseRuntimeLogs(junk)).toEqual([]);
  });

  it("handles huge nanosecond values without precision loss", () => {
    const [l] = parseRuntimeLogs({ data: [{ values: [["1767430000123456789", JSON.stringify({ _entry: "x" })]] }] });
    expect(l.tsNs).toBe("1767430000123456789");
    expect(l.ts).toBe("2026-01-03T08:46:40.123Z");
  });
});

describe("getRuntimeLogs", () => {
  it("uses v2 with start/direction/last_lines/releaseId", async () => {
    const { client, calls } = routes({ "GET /v2/projects/demo/logs": { json: v2Fx } });
    const res = await getRuntimeLogs(client, "demo", { startSec: 1767429999.7, releaseId: "r2", lastLines: true });
    expect(res.source).toBe("v2");
    expect(res.lines).toHaveLength(3);
    const q = calls[0].url.searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ start: "1767429999", direction: "forward", last_lines: "true", releaseId: "r2" });
  });

  it("falls back to v1 when v2 is missing (404) and remembers it", async () => {
    const { client, calls } = routes({ "GET /v1/projects/demo/logs": { json: v1Fx.logs } });
    const a = await getRuntimeLogs(client, "demo", { startSec: 100 });
    expect(a.source).toBe("v1");
    expect(calls.map((c) => c.path)).toEqual(["/v2/projects/demo/logs", "/v1/projects/demo/logs"]);
    expect(calls[1].url.searchParams.get("since")).toBe("100");
    await getRuntimeLogs(client, "demo", { startSec: 100 });
    expect(calls.map((c) => c.path).slice(2)).toEqual(["/v1/projects/demo/logs"]);
  });

  it("does not fall back on auth errors, and reports the v2 error when v1 fails too", async () => {
    const auth = routes({ "GET /v2/projects/demo/logs": { status: 401, json: {} } });
    await expect(getRuntimeLogs(auth.client, "demo", { startSec: 0 })).rejects.toMatchObject({ kind: "auth" });
    expect(auth.calls).toHaveLength(1);
    const none = routes({});
    await expect(getRuntimeLogs(none.client, "ghost", { startSec: 0 })).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("tailRuntimeLogs", () => {
  const entry = (ns: string, msg: string) => ({ metaData: { releaseId: "r" }, values: [[ns, JSON.stringify({ _entry: msg, type: "stdout" })]] });

  it("yields new lines only once across overlapping polls and advances the cursor", async () => {
    const polls = [
      { data: [entry("1700000001000000000", "a"), entry("1700000001500000000", "b")] },
      { data: [entry("1700000001000000000", "a"), entry("1700000001500000000", "b"), entry("1700000001500000000", "b2"), entry("1700000003000000000", "c")] },
      { data: [entry("1700000003000000000", "c"), entry("1700000004000000000", "d")] },
    ];
    const { client, calls } = clientFor((_c, n) => ({ json: polls[Math.min(n, polls.length) - 1] }));
    const ac = new AbortController();
    const got: LogLine[] = [];
    for await (const l of tailRuntimeLogs(client, "demo", { sinceSec: 1_700_000_000, intervalMs: 1, signal: ac.signal })) {
      got.push(l);
      if (l.message === "d") ac.abort();
    }
    expect(got.map((l) => l.message)).toEqual(["a", "b", "b2", "c", "d"]);
    expect(calls.map((c) => c.url.searchParams.get("start"))).toEqual(["1700000000", "1700000001", "1700000003"]);
  });

  it("survives transient errors but stops on auth/not_found", async () => {
    const ac = new AbortController();
    const flaky = clientFor((_c, n) => (n <= 1 ? { status: 500, json: {} } : { json: { data: [entry("1700000009000000000", "z")] } }), { retries: 0 });
    for await (const l of tailRuntimeLogs(flaky.client, "demo", { sinceSec: 1, intervalMs: 1, signal: ac.signal })) {
      expect(l.message).toBe("z");
      ac.abort();
    }
    const dead = clientFor(() => ({ status: 401, json: {} }));
    await expect(
      (async () => {
        for await (const _ of tailRuntimeLogs(dead.client, "demo", { intervalMs: 1 })) void _;
      })(),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("ends quietly when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const { client, calls } = clientFor(() => ({ json: { data: [] } }));
    const got: LogLine[] = [];
    for await (const l of tailRuntimeLogs(client, "demo", { signal: ac.signal })) got.push(l);
    expect(got).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("getBuildLogs", () => {
  it("passes the since cursor and parses lines", async () => {
    const { client, calls } = routes({ "GET /v2/releases/r1/build-logs": { json: buildFx } });
    const res = await getBuildLogs(client, "r1", { since: "2026-01-03T09:00:01Z" });
    expect(res.buildOutput.map((l) => l.stream)).toEqual(["STDOUT", "STDOUT"]);
    expect(res.release?.state).toBe("DEPLOYING");
    expect(calls[0].url.searchParams.get("since")).toBe("2026-01-03T09:00:01Z");
  });
});
