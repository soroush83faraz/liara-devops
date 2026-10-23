// Live defects of 2026-10-23 (investigate-only, rule-only mode) on ONE app whose releases v10..v14 ran one after
// another, so older releases' runtime lines were still inside the 15-minute window. Synthetic ids, live shapes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FindingSchema } from "@/lib/contracts/hypothesis";
import { ObservationSchema } from "@/lib/contracts/observation";
import { collectAppEvidence } from "@/lib/evidence/collect";
import { analyzeApp, releaseScope } from "@/lib/evidence/analyze";
import { buildRuleFindings } from "@/lib/evidence/hypotheses-rules";
import { screenModelCitations } from "@/lib/evidence/levels";
import { extractBuildError } from "@/lib/evidence/extract/build-error";
import { extractPortMismatch } from "@/lib/evidence/extract/port-mismatch";
import { extractProbe } from "@/lib/evidence/extract/probe";
import { stripAnsi } from "@/lib/evidence/lines";
import { TEMPORAL_SUMMARY } from "@/lib/evidence/temporal";
import type { EvidenceBundle, Observation } from "@/lib/evidence/types";
import { createLiaraClient, getBuildLogPages } from "@/lib/liara";
import type { ProbeResult } from "@/lib/canvas/types";
import { ctxOf, fakeLiara, pageBuildLogs, TEST_TOKEN, type Scenario } from "./helpers";

/* -------------------------------------------------------------- fixture */

interface RecordedBuildLogs {
  releaseId: string;
  pageSize: number;
  pages: Array<{ release: { _id: string; state: string }; buildOutput: Array<{ _id: string; line: string; stream: string; releaseID: string; createdAt: string }> }>;
}
const RECORDED = JSON.parse(readFileSync(join(__dirname, "../../fixtures/recorded/build-logs-2026-10-23.json"), "utf8")) as RecordedBuildLogs;
const ALL_BUILD = { release: RECORDED.pages[1].release, buildOutput: RECORDED.pages.flatMap((p) => p.buildOutput) };

/* ------------------------------------------------- one app, five releases */

const D = "2026-10-23T";
const R = {
  v10: { _id: "6a1f00000000000000000b10", tag: "v10", state: "READY", createdAt: `${D}02:40:00.000Z`, finishedAt: `${D}02:41:00.000Z`, port: 3000 },
  v11: { _id: "6a1f00000000000000000b11", tag: "v11", state: "READY", createdAt: `${D}02:52:31.000Z`, finishedAt: `${D}02:53:00.000Z`, port: 3000 },
  v12: { _id: "6a1f00000000000000000b12", tag: "v12", state: "READY", createdAt: `${D}02:56:00.000Z`, finishedAt: `${D}02:56:40.000Z`, port: 3000 },
  v13: { _id: "6a1f00000000000000000b13", tag: "v13", state: "READY", createdAt: `${D}03:01:00.000Z`, finishedAt: `${D}03:01:40.000Z`, port: 3000 },
  v14: { _id: RECORDED.releaseId, tag: "v14", state: "FAILED", createdAt: `${D}03:04:50.000Z`, finishedAt: `${D}03:05:40.000Z`, port: 3000 },
};
type Rel = (typeof R)[keyof typeof R];

const NS_PER_MS = BigInt(1_000_000);
const ns = (iso: string) => (BigInt(Date.parse(iso)) * NS_PER_MS).toString();
type Line = [string, "stdout" | "stderr", string];

/** Every runtime line the app ever wrote, per release (the API returns those inside the window). */
const RUNTIME: Record<string, Line[]> = {
  [R.v10._id]: [
    [`${D}02:41:05.000Z`, "stdout", "Server listening on port 3000"],
    [`${D}02:49:00.000Z`, "stderr", "Error: SESSION_SECRET is not set"],
    [`${D}02:50:20.000Z`, "stderr", "Error: SESSION_SECRET is not set"],
    [`${D}02:51:35.000Z`, "stderr", "Error: SESSION_SECRET is not set"],
  ],
  [R.v11._id]: [
    [`${D}02:53:02.000Z`, "stdout", "Server listening on port 3000"],
    ...[10, 40, 70, 100, 130, 150].flatMap((s): Line[] => {
      const t = new Date(Date.parse(`${D}02:53:00.000Z`) + s * 1000).toISOString();
      return [
        [t, "stderr", "TypeError: Cannot read properties of undefined (reading 'items')"],
        [t, "stderr", "    at renderCart (/app/src/cart.js:42:17)"],
      ];
    }),
  ],
  [R.v12._id]: [`${D}02:56:30.000Z`, `${D}02:57:30.000Z`, `${D}02:58:30.000Z`, `${D}02:59:30.000Z`].map((t): Line => [t, "stdout", "Server listening on port 8080"]),
  [R.v13._id]: [
    [`${D}03:01:05.000Z`, "stdout", "Server listening on port 3000"],
    ...[30, 90, 150, 210, 270, 330].map((s): Line => [new Date(Date.parse(`${D}03:01:00.000Z`) + s * 1000).toISOString(), "stdout", "GET /report 200 4800 ms"]),
  ],
};

interface LiveCase {
  now: string;
  releases: Rel[];
  current: Rel;
  probe: Omit<ProbeResult, "checkedAt">;
  cpu?: string;
  applet?: string;
  lifecycle?: Array<{ t: string; action: string; rel: Rel }>;
}

function liveScenario(c: LiveCase): Scenario {
  const now = Date.parse(c.now);
  const from = now - 15 * 60_000;
  const sec = Math.floor(now / 1000);
  const releases = [...c.releases].reverse(); // newest first, like the API
  const newest = releases[0];
  return {
    _note: "synthetic, shapes as recorded live 2026-10-23",
    scenario: "live-sequential",
    now: c.now,
    name: "demo-live",
    app: { project: { _id: "a1", project_id: "demo-live", type: "node", status: "RUNNING", scale: 1, planID: "small", envs: [{ key: "NODE_ENV", value: "production" }] } },
    applets: { applets: [{ id: "p1", name: "demo-live-1", timestamp: c.current.finishedAt, state: c.applet ?? "Running", reason: "", release: { releaseID: c.current._id, tag: c.current.tag } }] },
    releases: { total: releases.length, currentRelease: c.current._id, readyReleasesCount: releases.filter((r) => r.state === "READY").length, platform: "node", releases },
    releaseDetails: { [newest._id]: { release: newest } },
    buildLogs: newest.state === "FAILED" ? { [newest._id]: ALL_BUILD } : {},
    events: { data: (c.lifecycle ?? []).map((e) => ({ id: "c".repeat(64), status: e.action, action: e.action, time: String(Math.floor(Date.parse(e.t) / 1000)), release: e.rel._id, tag: e.rel.tag })) },
    logs: {
      data: Object.entries(RUNTIME).map(([releaseId, lines]) => ({
        metaData: { releaseId },
        values: lines.filter(([t]) => Date.parse(t) >= from && Date.parse(t) <= now).map(([t, type, text]) => [ns(t), JSON.stringify({ _entry: text, type })]),
      })),
    },
    metricsSummary: { cpuUsage: [{ applet: "p1", value: [sec, c.cpu ?? "0.10"] }], memoryUsage: [{ applet: "p1", value: [sec, "200000000"] }] },
    databaseDetails: {},
    probe: { ...c.probe, checkedAt: c.now },
    fail: {},
  } as Scenario;
}

async function investigate(s: Scenario) {
  const backend = fakeLiara(s);
  const bundle = await collectAppEvidence({
    liara: backend.client,
    name: s.name,
    probe: async () => s.probe,
    now: () => Date.parse(s.now),
    knownSecrets: [TEST_TOKEN],
    plan: { cpu: 1, ramGb: 1 },
    dbs: [],
  });
  const findings = buildRuleFindings({ observations: bundle.observations, unknowns: bundle.unknowns });
  return { bundle, findings, calls: backend.calls };
}

const byId = (b: EvidenceBundle) => new Map(b.observations.map((o) => [o.id, o]));
const historical = (b: EvidenceBundle) => b.observations.filter((o) => o.params.historical === 1);
const cited = (b: EvidenceBundle, ids: readonly string[]) => ids.map((id) => byId(b).get(id) as Observation);

function contractValid(bundle: EvidenceBundle, findings: ReturnType<typeof buildRuleFindings>) {
  for (const o of bundle.observations) expect(ObservationSchema.safeParse(o).success, o.id).toBe(true);
  const parsed = FindingSchema.safeParse({ facts: bundle.observations, hypotheses: findings.hypotheses, ruledOut: findings.ruledOut, unknowns: findings.unknowns, limitsNote: bundle.limits });
  expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
}

/** No hypothesis may cite a fact from a release that no longer serves. */
function noStaleCitations(bundle: EvidenceBundle, findings: ReturnType<typeof buildRuleFindings>) {
  for (const c of findings.candidates) for (const o of cited(bundle, [...c.supports, ...c.contradicts])) expect(o.params.historical, `${c.cause} cites ${o.id}`).toBeUndefined();
}

/* ---------------------------------------------------------------- tests */

describe("release scope", () => {
  it("current = currentRelease; newer releases are live, older and unlisted ones are history", () => {
    const rel = [R.v14, R.v13, R.v12].map((r) => ({ id: r._id, tag: r.tag, state: r.state, createdAt: r.createdAt }));
    const s = releaseScope(rel, R.v13._id)!;
    expect(s.currentId).toBe(R.v13._id);
    expect(s.liveIds).toEqual([R.v13._id, R.v14._id]);
    expect([R.v13._id, R.v14._id, R.v12._id, R.v10._id, undefined].map((id) => s.role(id))).toEqual(["current", "newer", "previous", "previous", undefined]);
    // Fallback: newest READY; no current at all -> no scoping.
    expect(releaseScope(rel, undefined)?.currentId).toBe(R.v13._id);
    expect(releaseScope([{ id: "x", state: "FAILED" }], undefined)).toBeUndefined();
  });

  it("crash-loop (v11 current): onset is v11's own first error, not v10's earlier line; v10 facts are history", async () => {
    const { bundle, findings } = await investigate(
      liveScenario({ now: `${D}02:56:00.000Z`, releases: [R.v10, R.v11], current: R.v11, probe: { ok: false, status: 502, latencyMs: 90 } }),
    );
    contractValid(bundle, findings);
    noStaleCitations(bundle, findings);
    const top = findings.candidates[0];
    expect(top.cause).toBe("crash_after_release");
    expect(top.evidence.level).toBe("strong");
    expect(top.actionHint).toBe("redeploy_previous");
    expect(top.titleFa).toContain("v11");
    expect(findings.candidates.map((c) => c.cause)).not.toContain("missing_env");
    // The onset belongs to v11 and is not older than its creation (live bug: 02:51:35 from v10, Δ -55s).
    const t = bundle.observations.filter((o) => o.summary === TEMPORAL_SUMMARY);
    expect(t.length).toBeGreaterThan(0);
    for (const o of t) {
      expect(o.params.releaseTag).toBe("v11");
      expect(Date.parse(String(o.params.onsetTs))).toBeGreaterThanOrEqual(Date.parse(R.v11.createdAt));
    }
    expect(bundle.correlation?.onsetTs).toBe(`${D}02:53:10.000Z`);
    // v10's SESSION_SECRET errors are kept as info facts marked historical.
    const hist = historical(bundle);
    expect(hist.map((o) => o.summary)).toContain("evidence.missing_env");
    for (const o of hist) {
      expect(o.severity).toBe("info");
      expect(o.params).toMatchObject({ release: "previous", historical: 1, releaseTag: "v10", sig: 0 });
    }
    expect(bundle.limits.some((l) => l.includes("v10"))).toBe(true);
  });

  it("wrong-port (v12 READY current): listen 8080 vs 3000 + probe 502 -> port hypothesis first, stale errors ignored", async () => {
    const lifecycle = [0, 20, 40].flatMap((s) => {
      const at = (d: number) => new Date(Date.parse(`${D}02:57:00.000Z`) + (s + d) * 1000).toISOString();
      return [{ t: at(0), action: "kill", rel: R.v12 }, { t: at(1), action: "die", rel: R.v12 }, { t: at(2), action: "stop", rel: R.v12 }, { t: at(5), action: "start", rel: R.v12 }];
    });
    const { bundle, findings } = await investigate(
      liveScenario({ now: `${D}03:00:00.000Z`, releases: [R.v10, R.v11, R.v12], current: R.v12, probe: { ok: false, status: 502, latencyMs: 300 }, lifecycle }),
    );
    contractValid(bundle, findings);
    noStaleCitations(bundle, findings);
    const top = findings.candidates[0];
    expect(top.cause).toBe("wrong_port");
    expect(top.evidence.level).toBe("strong");
    expect(top.actionHint).toBe("update_port");
    expect(top.titleFa).toContain("v12");
    const supports = cited(bundle, top.supports).map((o) => o.summary);
    expect(supports).toEqual(expect.arrayContaining(["evidence.port.listen_differs", "evidence.port.probe_refused_while_running", "evidence.probe.5xx"]));
    // The stale SESSION_SECRET (v10) and TypeError (v11) lines produce no hypothesis for the current state.
    expect(findings.candidates.map((c) => c.cause)).toEqual(["wrong_port"]);
    expect(historical(bundle).map((o) => o.params.releaseTag)).toEqual(expect.arrayContaining(["v10", "v11"]));
  });

  it("wrong-port while the applet is not running: probe 502 still counts as unreachable", async () => {
    const { bundle, findings } = await investigate(
      liveScenario({ now: `${D}03:00:00.000Z`, releases: [R.v10, R.v11, R.v12], current: R.v12, probe: { ok: false, status: 502, latencyMs: 300 }, applet: "Restarting" }),
    );
    const top = findings.candidates[0];
    expect(top.cause).toBe("wrong_port");
    expect(top.actionHint).toBe("update_port");
    expect(cited(bundle, top.supports).map((o) => o.summary)).toContain("evidence.port.probe_unreachable");
  });

  it("cpu-bound (v13 current): CPU saturation heads; v11's TypeError and v12's port line are history only", async () => {
    const { bundle, findings } = await investigate(
      liveScenario({ now: `${D}03:03:00.000Z`, releases: [R.v10, R.v11, R.v12, R.v13], current: R.v13, probe: { ok: true, status: 200, latencyMs: 4800 }, cpu: "0.98" }),
    );
    contractValid(bundle, findings);
    noStaleCitations(bundle, findings);
    expect(findings.candidates.map((c) => c.cause)).toEqual(["cpu_saturation"]);
    expect(findings.candidates[0].titleFa).toContain("v13");
    expect(findings.candidates[0].explanationFa).toContain("v13");
    expect(bundle.correlation?.withReleaseTag).not.toBe("v11");
    const hist = historical(bundle).map((o) => `${o.params.releaseTag} ${o.summary}`);
    expect(hist).toEqual(expect.arrayContaining(["v11 evidence.crash.exception", "v12 evidence.port.listen_differs"]));
  });

  it("build-failure (v14 FAILED, v13 still serves): newest-release failure first with the npm cause, v13 issue second", async () => {
    const { bundle, findings, calls } = await investigate(
      liveScenario({ now: `${D}03:07:00.000Z`, releases: [R.v10, R.v11, R.v12, R.v13, R.v14], current: R.v13, probe: { ok: true, status: 200, latencyMs: 4500 }, cpu: "0.97" }),
    );
    contractValid(bundle, findings);
    noStaleCitations(bundle, findings);
    // Both pages were read (page 1 alone ends at "> Running npm install...").
    expect(calls.filter((c) => c.endsWith("/build-logs")).length).toBeGreaterThanOrEqual(2);
    expect(bundle.sources.find((x) => x.source === "build_logs")).toMatchObject({ status: "ok", count: 24 });

    const notServing = bundle.observations.find((o) => o.summary === "evidence.release.newest_not_serving");
    expect(notServing?.params).toMatchObject({ newestTag: "v14", newestState: "FAILED", currentTag: "v13" });

    const [h1, h2] = findings.candidates;
    expect(h1.cause).toBe("build_failure");
    expect(h1.priority).toBe(true);
    expect(h1.titleFa).toContain("v14");
    expect(h1.titleFa).toContain("v13");
    expect(h1.explanationFa).toContain("express");
    expect(h1.explanationFa).toContain("^99.0.0");
    expect(h1.explanationFa).toContain("package.json");
    expect(["strong", "medium"]).toContain(h1.evidence.level);
    const npm = cited(bundle, h1.supports)[0];
    expect(npm.summary).toBe("evidence.build.npm_no_matching_version");
    expect(npm.params).toMatchObject({ code: "ETARGET", package: "express", range: "^99.0.0", release: "newer" });
    expect(h1.supports).toContain(notServing?.id);

    expect(h2.cause).toBe("cpu_saturation");
    expect(h2.titleFa).toContain("v13");
    // The serving release's CPU pressure keeps its own level next to the prioritised build failure (not suppressed):
    // 97% of the plan + a 4.5 s probe = signature only -> medium; a single summary value is not "sustained" -> no resize.
    expect(h2.evidence.level).toBe("medium");
    expect(h2.actionHint).toBeUndefined();
    expect(findings.hypotheses.find((h) => h.id === h2.id)?.level).toBe("medium");
    expect(findings.candidates.map((c) => c.cause)).not.toContain("crash_after_release");
    // The hypothesis ids follow the rank order.
    expect(findings.hypotheses[0].titleFa).toBe(h1.titleFa);
  });

  it("a current-release error after an older release's stale error: hypothesis about the current release only", () => {
    const now = Date.parse(`${D}03:03:00.000Z`);
    const line = (t: string, releaseId: string, message: string, stream = "stderr") => ({ ts: t, tsNs: ns(t), stream: stream as "stderr", message, releaseId });
    const bundle = analyzeApp({
      name: "demo-live",
      now,
      sources: [],
      releases: { currentRelease: R.v13._id, releases: [R.v13, R.v12, R.v11] },
      logs: [
        line(`${D}02:53:10.000Z`, R.v11._id, "Error: SESSION_SECRET is not set"),
        line(`${D}03:01:30.000Z`, R.v13._id, "Error: REDIS_URL is not set"),
        line(`${D}03:02:00.000Z`, R.v13._id, "Error: REDIS_URL is not set"),
      ],
    });
    const f = buildRuleFindings({ observations: bundle.observations });
    expect(f.candidates.map((c) => `${c.cause}:${c.titleFa.includes("REDIS_URL")}`)).toEqual(["missing_env:true"]);
    expect(f.candidates[0].titleFa).toContain("v13");
    expect(f.candidates[0].evidence.level).toBe("strong");
    const t = bundle.observations.find((o) => o.summary === TEMPORAL_SUMMARY);
    expect(t?.params).toMatchObject({ releaseTag: "v13", onsetTs: `${D}03:01:30.000Z` });
  });

  it("newest release UNHEALTHY while the previous one serves: the crash hypothesis names both releases", () => {
    const unhealthy = { ...R.v14, state: "UNHEALTHY" };
    const line = (t: string, message: string) => ({ ts: t, tsNs: ns(t), stream: "stderr" as const, message, releaseId: unhealthy._id });
    const bundle = analyzeApp({
      name: "demo-live",
      now: Date.parse(`${D}03:08:00.000Z`),
      sources: [],
      releases: { currentRelease: R.v13._id, releases: [unhealthy, R.v13] },
      logs: [line(`${D}03:05:10.000Z`, "TypeError: boom"), line(`${D}03:05:10.000Z`, "    at main (/app/index.js:3:9)"), line(`${D}03:05:20.000Z`, "TypeError: boom")],
    });
    const f = buildRuleFindings({ observations: bundle.observations });
    const top = f.candidates[0];
    expect(top.cause).toBe("crash_after_release");
    expect(top.titleFa).toContain("v14");
    expect(top.titleFa).toContain("v13");
    expect(cited(bundle, top.supports).map((o) => o.summary)).toContain("evidence.release.newest_not_serving");
    const crash = bundle.observations.find((o) => o.summary === "evidence.crash.exception");
    expect(crash?.params).toMatchObject({ release: "newer", releaseTag: "v14" });
  });

  it("model citations of historical facts are screened out", () => {
    const o: Observation = { id: "O1", kind: "missing_env", severity: "info", source: "liara:logs", summary: "evidence.missing_env", text: "x", params: { historical: 1, release: "previous", sig: 0 } };
    expect(screenModelCitations("missing_env", ["O1"], [], [o])).toMatchObject({ supports: [], nonIndicative: ["O1"] });
  });
});

describe("build logs: pagination, ANSI, npm ETARGET on STDOUT", () => {
  function pagedClient(store: unknown, opts: { failPage?: number } = {}) {
    const calls: Array<string | null> = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      calls.push(url.searchParams.get("since"));
      if (opts.failPage === calls.length) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(pageBuildLogs(store, url.searchParams.get("since"))), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { client: createLiaraClient({ token: TEST_TOKEN, teamId: "t1", fetchImpl, retries: 0, timeoutMs: 2000 }), calls };
  }

  it("page 1 alone ends at '> Running npm install...' (the live bug)", () => {
    expect(RECORDED.pages[0].buildOutput).toHaveLength(20);
    expect(RECORDED.pages[0].buildOutput.at(-1)?.line).toContain("> Running npm install...");
    expect(JSON.stringify(RECORDED.pages[0])).not.toContain("ETARGET");
  });

  it("reads every page with since=<last createdAt>, de-duplicates by _id and stops when nothing new arrives", async () => {
    const { client, calls } = pagedClient(ALL_BUILD);
    const r = await getBuildLogPages(client, RECORDED.releaseId);
    expect(r.buildOutput.map((l) => l._id)).toEqual(ALL_BUILD.buildOutput.map((l) => l._id));
    expect(new Set(r.buildOutput.map((l) => l._id)).size).toBe(24);
    expect(calls[0]).toBeNull();
    expect(calls[1]).toBe(RECORDED.pages[0].buildOutput[19].createdAt);
    expect(r).toMatchObject({ partial: false, release: { state: "FAILED" } });
    expect(r.pages).toBe(calls.length);
  });

  it("honours the page and line caps, and keeps what it read when a later page fails", async () => {
    const big = { buildOutput: Array.from({ length: 95 }, (_, i) => ({ _id: `l${i}`, line: `line ${i}`, stream: "STDOUT", releaseID: "r", createdAt: new Date(Date.UTC(2026, 9, 23, 3, 0, i)).toISOString() })) };
    const capped = await getBuildLogPages(pagedClient(big).client, "r", { maxPages: 2 });
    expect(capped).toMatchObject({ pages: 2, partial: true });
    expect(capped.buildOutput).toHaveLength(39);
    const lines = await getBuildLogPages(pagedClient(big).client, "r", { maxLines: 30 });
    expect(lines).toMatchObject({ partial: true });
    expect(lines.buildOutput).toHaveLength(30);
    const failed = await getBuildLogPages(pagedClient(ALL_BUILD, { failPage: 2 }).client, "r");
    expect(failed).toMatchObject({ pages: 1, partial: true });
    expect(failed.buildOutput).toHaveLength(20);
    await expect(getBuildLogPages(pagedClient(ALL_BUILD, { failPage: 1 }).client, "r")).rejects.toBeTruthy();
    const ac = new AbortController();
    ac.abort();
    await expect(getBuildLogPages(pagedClient(ALL_BUILD).client, "r", { signal: ac.signal })).rejects.toBeTruthy();
  });

  it("strips ANSI colour codes", () => {
    expect(stripAnsi("\u001b[91mnpm error code ETARGET\u001b[0m")).toBe("npm error code ETARGET");
    expect(stripAnsi("\u001b]0;title\u0007plain \u001b[1;32mok\u001b[39m")).toBe("plain ok");
  });

  it("names code, package and range from STDOUT-only npm output; the Docker step line is context, not the cause", () => {
    const bundle = analyzeApp({
      name: "demo-live",
      now: Date.parse(`${D}03:07:00.000Z`),
      sources: [],
      releases: { currentRelease: R.v13._id, releases: [R.v14, R.v13] },
      buildLogs: ALL_BUILD,
    });
    const build = bundle.observations.filter((o) => o.kind === "build_error");
    const npm = build.find((o) => o.summary === "evidence.build.npm_no_matching_version");
    expect(npm?.params).toMatchObject({ code: "ETARGET", package: "express", range: "^99.0.0", sig: 1 });
    expect(npm?.text.split("\n")).toEqual([
      "npm error code ETARGET",
      "npm error notarget No matching version found for express@^99.0.0.",
      "npm error notarget In most cases you or one of your dependencies are requesting",
    ]);
    expect(JSON.stringify(bundle)).not.toContain("\u001b");
    const step = build.find((o) => o.summary === "evidence.build.docker_step_failed");
    expect(step).toMatchObject({ severity: "info", params: { generic: 1, sig: 0 } });
    // Without any specific error the Docker step line is still the (only) signature.
    const only = extractBuildError(ctxOf({ releases: [{ state: "FAILED", tag: "v9" }], build: [{ message: RECORDED.pages[1].buildOutput[3].line, stream: "STDERR" }] }));
    expect(only.map((o) => [o.summary, o.params.sig])).toEqual([["evidence.build.docker_step_failed", 1]]);
  });

  it.each([
    ["npm ERR! notarget No matching version found for @scope/pkg@~1.2.3.", { rule: "npm_no_matching_version", code: "ETARGET", package: "@scope/pkg", range: "~1.2.3" }],
    ["npm ERR! code E404", { rule: "npm_error", code: "E404" }],
    ["npm error code ERESOLVE", { rule: "npm_eresolve", code: "ERESOLVE" }],
    ["Error: Cannot find module 'dotenv'", { rule: "missing_module", package: "dotenv" }],
    ["ERROR: No matching distribution found for djangoo==9.0", { rule: "pip_no_distribution", package: "djangoo", range: "==9.0" }],
    ["  - Root composer.json requires laravel/framework ^99.0, found laravel/framework[v10.0.0] but it does not match the constraint.", { rule: "composer_requires", package: "laravel/framework", range: "^99.0" }],
  ])("build error facts: %s", (line, params) => {
    for (const stream of ["STDOUT", "STDERR"]) {
      const [o] = extractBuildError(ctxOf({ releases: [{ state: "FAILED", tag: "v9" }], build: [{ message: line, stream }] }));
      expect(o.params).toMatchObject({ ...params, sig: 1 });
    }
  });
});

describe("probe unreachable", () => {
  const probe = (p: Partial<ProbeResult>): ProbeResult => ({ ok: false, latencyMs: 100, checkedAt: `${D}03:00:00.000Z`, ...p });
  it.each([
    [{ status: 502 }, 1],
    [{ status: 504 }, 1],
    [{ error: "refused" as const }, 1],
    [{ error: "timeout" as const }, 1],
    [{ status: 500 }, 0],
  ])("%o -> unreachable=%i", (p, unreachable) => {
    expect(extractProbe(ctxOf({ probe: probe(p) }))[0].params.unreachable).toBe(unreachable);
  });
  it("a gateway error with a listen mismatch is a port signal even when no applet runs", () => {
    const ctx = ctxOf({ app: { name: "a", envKeys: [], configuredPort: 3000 }, logs: ["Server listening on port 8080"], probe: probe({ status: 502 }), applets: [{ state: "Restarting" }] });
    expect(extractPortMismatch(ctx).map((o) => o.summary)).toEqual(["evidence.port.listen_differs", "evidence.port.probe_unreachable"]);
    // An app-generated 500 is not "unreachable".
    expect(extractPortMismatch({ ...ctx, probe: probe({ status: 500 }) }).map((o) => o.summary)).toEqual(["evidence.port.listen_differs"]);
  });
});
