// Rule-based hypothesis candidates: the deterministic fallback when the LLM is down, and the baseline the
// LLM re-ranks. Pure. Flagged (possible prompt-injection) observations are never used.
import type { Hypothesis, RuledOut, UnknownItem } from "@/lib/contracts/hypothesis";
import type { ActionType } from "@/lib/contracts/action";
import { CAUSE_FA, fill, RULED_OUT_FA, type FaParams } from "./fa-templates";
import { CAUSES, computeEvidenceLevel, isHistorical, levelRank, SIGNATURE_KINDS, validateCitations, type Cause, type EvidenceLevelResult } from "./levels";
import { GENERIC_BUILD_RULES } from "./extract/build-error";
import { isSignature, paramNum, paramStr } from "./observe";
import { CORRELATION_SKEW_SEC, CORRELATION_WINDOW_SEC, TEMPORAL_SUMMARY } from "./temporal";
import { CPU_PATH_SUMMARY } from "./extract/metric";
import type { EvidenceUnknown, Observation } from "./types";

export interface RuleCandidate {
  /** Id of the matching entry in `RuleFindings.hypotheses` (absent if validation dropped it). */
  id?: string;
  cause: Cause;
  titleFa: string;
  explanationFa: string;
  supports: string[];
  contradicts: string[];
  actionHint?: ActionType;
  evidence: EvidenceLevelResult;
  /** Release the hypothesis is about, when known. */
  releaseTag?: string;
  /** Ranked before every other candidate (the newest release failed with an evidenced cause). */
  priority?: boolean;
}

export interface RuleFindings {
  candidates: RuleCandidate[];
  /** Schema-valid hypotheses (H1..) in rank order. */
  hypotheses: Hypothesis[];
  ruledOut: RuledOut[];
  unknowns: UnknownItem[];
}

export interface RuleInput {
  observations: readonly Observation[];
  unknowns?: readonly EvidenceUnknown[];
}

const MAX_PER_CAUSE = 3;
const MAX_CANDIDATES = 8;

const has = (o: Observation, summary: string) => o.summary === summary;
const ids = (os: readonly Observation[]) => [...new Set(os.map((o) => o.id))];

/** The within-5-min temporal observation whose change window contains one of `sig`'s first occurrences. */
function correlatedTemporal(sig: readonly Observation[], temporal: readonly Observation[]): Observation | undefined {
  for (const t of temporal) {
    if (paramNum(t, "within5min") !== 1) continue;
    const start = Date.parse(paramStr(t, "changeStartTs") ?? paramStr(t, "changeTs") ?? "");
    const end = Date.parse(paramStr(t, "changeTs") ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const hit = sig.some((o) => {
      const ms = Date.parse(o.ts ?? "");
      return Number.isFinite(ms) && ms >= start - CORRELATION_SKEW_SEC * 1000 && ms <= end + CORRELATION_WINDOW_SEC * 1000;
    });
    if (hit) return t;
  }
  return undefined;
}

interface Spec {
  cause: Cause;
  title: string;
  body: string[];
  supports: Observation[];
  contradicts?: Observation[];
  actionHint?: ActionType;
  /** Release this hypothesis concerns; default: the release of its log-derived supports, else the current one. */
  scope?: { role: "current" | "newer"; tag?: string; mentioned?: boolean };
  priority?: boolean;
  /** Which temporal (onset-after-change) observations may count as this cause's correlation; default all. */
  temporalOk?: (t: Observation) => boolean;
}

/** Build observations that name a specific cause (not Liara's failReason, a generic step line or raw STDERR). */
const specificBuild = (o: Observation) => isSignature(o) && !["fail_reason", "stderr"].includes(paramStr(o, "rule") ?? "") && !GENERIC_BUILD_RULES.has(paramStr(o, "rule") ?? "");

export function buildRuleFindings(input: RuleInput): RuleFindings {
  const all = input.observations;
  // Facts from releases that no longer serve stay visible as history but never feed a diagnosis.
  const obs = all.filter((o) => !o.flagged && !isHistorical(o));
  const kind = (k: Observation["kind"]) => obs.filter((o) => o.kind === k);
  const temporal = obs.filter((o) => has(o, TEMPORAL_SUMMARY));
  const current = obs.find((o) => has(o, "evidence.release.current"));
  const currentTag = current ? paramStr(current, "releaseTag") : undefined;
  const notServing = obs.find((o) => has(o, "evidence.release.newest_not_serving"));
  const probe = kind("probe")[0];
  const memory = kind("metric").find((o) => paramStr(o, "metric") === "memory");
  const cpu = kind("metric").find((o) => paramStr(o, "metric") === "cpu");
  const probeFailing = probe && (paramNum(probe, "ok") === 0) && !/skipped/.test(probe.summary) ? probe : undefined;
  const http5xx = kind("http_status").find((o) => (paramNum(o, "s5xx") ?? 0) > 0);
  const crashloop = kind("crash").filter((o) => has(o, "evidence.crash.crashloop"));
  const exitCodes = kind("crash").filter((o) => has(o, "evidence.crash.exit_code"));
  const unhealthy = kind("applet_state").filter((o) => o.summary !== "evidence.applet.summary");
  const symptoms = [...crashloop, ...exitCodes, ...(probeFailing ? [probeFailing] : []), ...(http5xx ? [http5xx] : []), ...unhealthy];
  const crashBy = (by: string) => kind("crash").filter((o) => paramStr(o, "explainedBy") === by);
  const specs: Spec[] = [];

  // 1. missing config / env
  for (const m of kind("missing_env").slice(0, MAX_PER_CAUSE)) {
    const key = paramStr(m, "key");
    const cfg = kind("config").filter((c) => paramStr(c, "key") === key && /key_(?:absent|present)/.test(c.summary));
    const present = cfg.filter((c) => has(c, "evidence.config.key_present"));
    specs.push({
      cause: "missing_env",
      title: fill(CAUSE_FA.missing_env.title, { key }),
      body: [fill(CAUSE_FA.missing_env.body, { key, count: paramNum(m, "count") }), present.length ? CAUSE_FA.missing_env.present : cfg.length ? CAUSE_FA.missing_env.absent : ""],
      supports: [m, ...cfg.filter((c) => !present.includes(c)), ...crashBy("missing_env"), ...symptoms],
      contradicts: present,
      actionHint: "set_env",
    });
  }

  // 2. wrong port
  const port = kind("port_mismatch");
  if (port.length) {
    const differs = port.find((o) => has(o, "evidence.port.listen_differs"));
    const lines = port.map((o) => {
      const sub = o.summary.split(".").pop() ?? "";
      const tpl = sub === "probe_refused_while_running" ? CAUSE_FA.wrong_port.probe_refused : sub === "probe_unreachable" ? CAUSE_FA.wrong_port.probe_unreachable : (CAUSE_FA.wrong_port as Record<string, string>)[sub];
      return tpl ? fill(tpl, { ...o.params, probe: paramNum(o, "probeStatus") ?? paramStr(o, "probeError") }) : "";
    });
    specs.push({
      cause: "wrong_port",
      title: CAUSE_FA.wrong_port.title,
      body: lines,
      supports: [...port, ...crashBy("port"), ...symptoms],
      contradicts: [...kind("config").filter((c) => has(c, "evidence.config.port_matches"))],
      actionHint: differs ? "update_port" : undefined,
    });
  }

  // 3/4. database unreachable vs external dependency
  const conns = kind("connection_error");
  const dbConns = conns.filter((o) => ["db", "local"].includes(paramStr(o, "target") ?? ""));
  const extConns = conns.filter((o) => !dbConns.includes(o));
  const dbBad = kind("db_state").filter((o) => isSignature(o));
  if (dbConns.length || dbBad.length) {
    const c = dbConns[0];
    const stopped = dbBad.find((o) => /\.(?:stopped|not_running)$/.test(o.summary));
    const body = [
      c ? fill(CAUSE_FA.db_unreachable.body, { host: paramStr(c, "host") ?? paramStr(c, "dbHostname"), port: paramNum(c, "port") ? `:${paramNum(c, "port")}` : "", code: paramStr(c, "code"), count: paramNum(c, "count") }) : "",
      c && paramStr(c, "target") === "local" ? CAUSE_FA.db_unreachable.local : "",
      ...dbBad.map((o) => {
        const sub = o.summary.split(".").pop() ?? "";
        const tpl = sub === "public_off_but_used" ? CAUSE_FA.db_unreachable.public_off : (CAUSE_FA.db_unreachable as Record<string, string>)[sub];
        return tpl ? fill(tpl, o.params) : "";
      }),
    ];
    const host = (c && (paramStr(c, "dbHostname") ?? paramStr(c, "host"))) ?? (dbBad[0] && paramStr(dbBad[0], "hostname"));
    specs.push({
      cause: "db_unreachable",
      title: fill(CAUSE_FA.db_unreachable.title, { host }),
      body,
      supports: [...dbConns, ...dbBad, ...crashBy("connection").filter(() => dbConns.length > 0), ...symptoms],
      // A healthy probe is NOT a contradiction: "/" may not touch the database.
      actionHint: stopped ? "scale" : undefined,
    });
  }
  for (const e of extConns.slice(0, MAX_PER_CAUSE)) {
    specs.push({
      cause: "external_dependency",
      title: fill(CAUSE_FA.external_dependency.title, { host: paramStr(e, "host") ?? "?" }),
      body: [fill(CAUSE_FA.external_dependency.body, { host: paramStr(e, "host"), code: paramStr(e, "code"), count: paramNum(e, "count") })],
      supports: [e, ...(http5xx ? [http5xx] : [])],
    });
  }

  // 5. dependency / build failure. When the newest release failed while an older one keeps serving, the
  // hypothesis says so and (with an evidenced cause in the build output) is ranked first.
  const builds = kind("build_error");
  const badRelease = kind("release_state").filter((o) => /\.(?:failed|timedout)$/.test(o.summary) || (has(o, "evidence.release.canceled") && builds.length > 0));
  if (builds.length || badRelease.length) {
    const first = builds.find(specificBuild) ?? builds.find((b) => isSignature(b)) ?? builds[0];
    const newestIsCurrent = current ? paramNum(current, "newestIsCurrent") === 1 : false;
    const tag = paramStr(badRelease[0] ?? first, "releaseTag");
    const serving = notServing && (!tag || paramStr(notServing, "newestTag") === tag) ? notServing : undefined;
    const servingTag = serving ? paramStr(serving, "currentTag") : undefined;
    const rule = first ? paramStr(first, "rule") : undefined;
    const fix = rule ? CAUSE_FA.build_failure.fix[rule] : undefined;
    const ordered = [...builds.filter(specificBuild), ...builds.filter((b) => !specificBuild(b))];
    const fromBuildOutput = builds.some((b) => specificBuild(b) && b.source !== "liara:logs");
    specs.push({
      cause: "build_failure",
      title: serving ? fill(CAUSE_FA.build_failure.titleServing, { tag, currentTag: servingTag }) : fill(CAUSE_FA.build_failure.title, { tag }),
      body: [
        fill(CAUSE_FA.build_failure.body, { detail: paramStr(first ?? badRelease[0], "detail") ?? paramStr(first ?? badRelease[0], "failReason") ?? paramStr(first ?? badRelease[0], "rule") ?? paramStr(badRelease[0], "state") }),
        fix && first ? fill(fix, { package: paramStr(first, "package"), range: paramStr(first, "range"), code: paramStr(first, "code") }) : "",
        serving
          ? fill(CAUSE_FA.build_failure.serving, { tag, state: paramStr(serving, "newestState"), currentTag: servingTag })
          : current && !newestIsCurrent && badRelease.length ? CAUSE_FA.build_failure.running : "",
      ],
      supports: [...ordered, ...badRelease, ...(serving ? [serving] : []), ...crashBy("dependency")],
      // A failed newest release is not the serving one; a runtime "Cannot find module" is about the current release.
      scope: badRelease.length || serving ? { role: "newer", tag, mentioned: true } : undefined,
      priority: Boolean(serving || badRelease.length) && fromBuildOutput,
    });
  }

  // 6. OOM
  const ooms = kind("oom");
  if (ooms.length) {
    const kills = Math.max(...ooms.map((o) => paramNum(o, "kills") ?? 1));
    const explicit = ooms.some((o) => paramStr(o, "scope") !== "kill");
    const heapOnly = ooms.every((o) => paramStr(o, "scope") === "heap");
    const memHigh = memory && isSignature(memory) ? [memory] : [];
    const memLow = memory && (paramNum(memory, "memPct") ?? 100) < 70 && !explicit ? [memory] : [];
    const growing = memory ? paramNum(memory, "growing") === 1 : false;
    specs.push({
      cause: "oom",
      title: CAUSE_FA.oom.title,
      body: [heapOnly ? CAUSE_FA.oom.heap : fill(CAUSE_FA.oom.body, { kills }), memory && paramNum(memory, "memPct") !== undefined ? fill(CAUSE_FA.oom.mem, { memPct: paramNum(memory, "memPct") }) : ""],
      supports: [...ooms, ...memHigh, ...crashBy("oom"), ...crashloop],
      contradicts: memLow,
      // A single container OOM kill without growth is treated as transient; repeated kills need more memory.
      actionHint: heapOnly ? undefined : kills <= 1 && !growing ? "restart" : "resize",
    });
  }

  // 7. CPU saturation (explicitly not memory: memory observations are never cited here). The metric extractor makes
  // the CPU observation a signature only with pressure AND a latency symptom (or >= 80% sustained), so this is medium;
  // strong needs the slow requests of one path starting with the pressure, or the onset right after a release with
  // calm CPU before it. Competing runtime errors / OOM lower it (listed as contradictions). Never a restart or RAM hint.
  if (cpu && isSignature(cpu)) {
    const corr = paramStr(cpu, "corroboration");
    const latencyMs = probe ? paramNum(probe, "latencyMs") : undefined;
    const symptom = probe && corr?.startsWith("probe_") ? [probe] : [];
    const latency = http5xx && corr === "http_5xx" ? [http5xx] : [];
    const path = kind("http_status").find((o) => has(o, CPU_PATH_SUMMARY));
    const pathName = path ? paramStr(path, "path") : undefined;
    const competing = [...ooms, ...kind("crash").filter((o) => isSignature(o)), ...kind("connection_error").filter((o) => isSignature(o))];
    const planCpu = paramNum(cpu, "planCpu");
    const peakPct = paramNum(cpu, "peakPct") ?? paramNum(cpu, "cpuPct");
    const sustained = paramNum(cpu, "sustained") === 1;
    const T = CAUSE_FA.cpu_saturation;
    const calmSince = Date.parse(paramStr(cpu, "calmSinceTs") ?? "");
    const firstHigh = Date.parse(paramStr(cpu, "firstHighTs") ?? "");
    specs.push({
      cause: "cpu_saturation",
      title: T.title,
      body: [
        fill(T.body, {
          peakCores: peakPct !== undefined && planCpu ? Math.round(peakPct * planCpu) / 100 : paramNum(cpu, "cpuCores"),
          peakPct,
          planCpu,
          // `fill` trims, so the leading space of the clause is added back here.
          detail: sustained ? T.sustained : (paramNum(cpu, "sustainedSamples") ?? 0) >= 2 ? ` ${fill(T.run, { run: paramNum(cpu, "sustainedSamples") })}` : "",
        }),
        planCpu !== undefined && planCpu < 1 && !sustained ? T.singleCore : "",
        corr === "probe_timeout" ? fill(T.timeout, { latencyMs }) : corr === "probe_slow" ? fill(T.slow, { latencyMs }) : corr === "http_5xx" || corr === "probe_5xx" ? T.http5xx : corr === "slow_requests" ? T.slowRequests : "",
        path ? fill(T.path, { path: pathName, count: paramNum(path, "slowCount") }) : "",
        path && paramNum(path, "correlated") === 1 ? fill(T.pathOnset, { path: pathName }) : "",
        competing.length ? T.competing : "",
        T.noHelp,
        pathName ? fill(T.suggestionPath, { path: pathName }) : T.suggestion,
      ],
      supports: [cpu, ...symptom, ...latency, ...(path ? [path] : [])],
      contradicts: competing,
      // A bigger plan only for sustained (>= 80%) AND corroborated pressure; tier 2, costed and validated in propose-plan.
      actionHint: sustained && paramNum(cpu, "corroborated") === 1 ? "resize" : undefined,
      // Release correlation only with "metrics before/after": a calm sample (any container) before the release started,
      // and no high sample before it finished (so the old container was not already saturated). A fresh container
      // after a rolling restart alone proves nothing.
      temporalOk: (t) => {
        const start = Date.parse(paramStr(t, "changeStartTs") ?? paramStr(t, "changeTs") ?? "");
        const end = Date.parse(paramStr(t, "changeTs") ?? "");
        return paramStr(t, "changeKind") === "release" && calmSince < start && firstHigh >= end;
      },
    });
  }

  // 8. crash / bug after release: exception heads no other cause explains, or bare crash symptoms.
  const unexplained = kind("crash").filter((o) => has(o, "evidence.crash.exception") && !paramStr(o, "explainedBy"));
  const unhealthyRelease = kind("release_state").filter((o) => has(o, "evidence.release.unhealthy"));
  if (unexplained.length || ((crashloop.length || exitCodes.length || unhealthyRelease.length) && specs.length === 0)) {
    const head = unexplained[0] ?? crashloop[0] ?? exitCodes[0];
    // The newest release came up unhealthy while an older one keeps serving: say so, and scope to that release.
    const unhealthyNewest = notServing && paramStr(notServing, "newestState") === "UNHEALTHY" ? notServing : undefined;
    const newestTag = unhealthyNewest ? paramStr(unhealthyNewest, "newestTag") : undefined;
    specs.push({
      cause: "crash_after_release",
      title: unhealthyNewest ? fill(CAUSE_FA.release_scope.titleUnhealthy, { tag: newestTag, currentTag: paramStr(unhealthyNewest, "currentTag") }) : "",
      ...(unhealthyNewest ? { scope: { role: "newer" as const, tag: newestTag, mentioned: true } } : {}),
      body: [
        head && has(head, "evidence.crash.exception")
          ? fill(CAUSE_FA.crash_after_release.body, { errorType: paramStr(head, "errorType"), count: paramNum(head, "count"), frame: paramStr(head, "frame") ? fill(CAUSE_FA.crash_after_release.frame, { frame: paramStr(head, "frame") }) : "" })
          : "",
        crashloop[0] ? fill(CAUSE_FA.crash_after_release.crashloop, { restarts: paramNum(crashloop[0], "restarts") }) : "",
        unhealthyNewest ? fill(CAUSE_FA.build_failure.serving, { tag: newestTag, state: "UNHEALTHY", currentTag: paramStr(unhealthyNewest, "currentTag") }) : "",
      ],
      supports: [...unexplained, ...unhealthyRelease, ...(unhealthyNewest ? [unhealthyNewest] : []), ...crashloop, ...exitCodes, ...(probeFailing ? [probeFailing] : []), ...(http5xx ? [http5xx] : [])],
    });
  }

  // 9. transient / unknown: unhealthy or unreachable with no error signature anywhere. Always weak, so it carries no
  // action: a restart "just in case" is not evidence-based (the live cpu-bound run got one, and it would not have helped).
  if (specs.length === 0 && (unhealthy.length || probeFailing || http5xx)) {
    const symptom = probeFailing ? probeFailing.text : unhealthy[0]?.text ?? http5xx?.text ?? "";
    specs.push({
      cause: "transient_unknown",
      title: CAUSE_FA.transient_unknown.title,
      body: [fill(CAUSE_FA.transient_unknown.body, { symptom }), CAUSE_FA.transient_unknown.more],
      supports: [...unhealthy, ...(probeFailing ? [probeFailing] : []), ...(http5xx ? [http5xx] : [])],
    });
  }

  // Correlation, levels, Persian text.
  // The release a hypothesis concerns: explicit, else that of its (signature-first) log-derived supports, else current.
  const scopeOf = (s: Spec): Spec["scope"] => {
    if (s.scope) return s.scope;
    const tagged = [...s.supports.filter(isSignature), ...s.supports].find((o) => ["current", "newer"].includes(paramStr(o, "release") ?? ""));
    if (tagged) return { role: paramStr(tagged, "release") as "current" | "newer", tag: paramStr(tagged, "releaseTag") };
    return currentTag ? { role: "current", tag: currentTag } : undefined;
  };

  const candidates: RuleCandidate[] = specs.map((s) => {
    const sigs = s.supports.filter((o) => isSignature(o) && SIGNATURE_KINDS[s.cause].includes(o.kind));
    const t = correlatedTemporal(sigs, s.temporalOk ? temporal.filter(s.temporalOk) : temporal);
    const supports = ids(t ? [...s.supports, t] : s.supports);
    const contradicts = ids(s.contradicts ?? []).filter((id) => !supports.includes(id));
    const evidence = computeEvidenceLevel({ supports, contradicts, cause: s.cause }, all);
    const releaseTag = t && paramStr(t, "changeKind") === "release" ? paramStr(t, "releaseTag") : undefined;
    let { title, actionHint } = s;
    const body = [...s.body];
    if (s.cause === "cpu_saturation" && t && releaseTag) body.splice(1, 0, fill(CAUSE_FA.cpu_saturation.afterRelease, { tag: releaseTag, delta: paramNum(t, "deltaSec") }));
    if (s.cause === "crash_after_release") {
      if (!title) title = releaseTag ? fill(CAUSE_FA.crash_after_release.title, { tag: releaseTag }) : CAUSE_FA.crash_after_release.titleNoRelease;
      const prevTag = current ? paramStr(current, "previousReadyTag") : undefined;
      if (releaseTag) body.push(fill(CAUSE_FA.crash_after_release.after, { tag: releaseTag, delta: paramNum(t!, "deltaSec") }));
      // Deterministic app errors never get "restart"; going back is only offered when a newer release
      // coincides with the onset and an older READY release exists.
      if (releaseTag && prevTag && current && paramNum(current, "newestIsCurrent") === 1) {
        body.push(fill(CAUSE_FA.crash_after_release.previous, { previousTag: prevTag }));
        actionHint = "redeploy_previous";
      }
    }
    const scope = scopeOf(s);
    if (scope?.tag && !scope.mentioned) {
      const tpl = CAUSE_FA.release_scope;
      if (!title.includes(scope.tag)) title = `${title} ${fill(scope.role === "newer" ? tpl.titleNewer : tpl.title, { tag: scope.tag })}`;
      body.push(fill(scope.role === "newer" ? tpl.newer : tpl.current, { tag: scope.tag, currentTag }));
    }
    return {
      cause: s.cause,
      titleFa: title,
      explanationFa: body.filter(Boolean).join(" ") || title,
      supports,
      contradicts,
      ...(actionHint ? { actionHint } : {}),
      evidence,
      ...(scope?.tag ? { releaseTag: scope.tag } : {}),
      ...(s.priority ? { priority: true } : {}),
    };
  });

  candidates.sort(
    (a, b) =>
      Number(Boolean(b.priority)) - Number(Boolean(a.priority)) ||
      levelRank(b.evidence.level) - levelRank(a.evidence.level) ||
      CAUSES.indexOf(a.cause) - CAUSES.indexOf(b.cause),
  );
  const kept = candidates.slice(0, MAX_CANDIDATES);
  const validated = validateCitations(
    kept.map((c, i) => ({ id: `H${i + 1}`, titleFa: c.titleFa, explanationFa: c.explanationFa, supports: c.supports, contradicts: c.contradicts, actionHint: c.actionHint, cause: c.cause })),
    all,
  );

  const valid = new Set(validated.hypotheses.map((h) => h.id));
  return {
    candidates: kept.map((c, i) => (valid.has(`H${i + 1}`) ? { id: `H${i + 1}`, ...c } : c)),
    hypotheses: validated.hypotheses,
    ruledOut: ruledOut(obs, kept),
    unknowns: (input.unknowns ?? []).slice(0, 10).map((u) => ({ descriptionFa: u.descriptionFa, ...(u.howToGet ? { howToGet: u.howToGet } : {}) })),
  };
}

function ruledOut(obs: readonly Observation[], candidates: readonly RuleCandidate[]): RuledOut[] {
  const out: RuledOut[] = [];
  const causes = new Set(candidates.map((c) => c.cause));
  const push = (t: { title: string; reason: string }, o: Observation, p: FaParams) =>
    out.push({ titleFa: fill(t.title, p), reasonFa: fill(t.reason, p), observationIds: [o.id] });

  const memory = obs.find((o) => o.kind === "metric" && paramStr(o, "metric") === "memory");
  const memPct = memory ? paramNum(memory, "memPct") : undefined;
  if (memory && memPct !== undefined && memPct < 70 && !causes.has("oom")) push(RULED_OUT_FA.memory, memory, { memPct });
  const cpu = obs.find((o) => o.kind === "metric" && paramStr(o, "metric") === "cpu");
  const cpuPct = cpu ? paramNum(cpu, "cpuPct") : undefined;
  // Only a CPU that never came near the pressure threshold rules CPU out (not a momentary dip of a pressured series).
  if (cpu && cpu.summary === "evidence.metric.cpu_normal" && cpuPct !== undefined && cpuPct < 50 && !causes.has("cpu_saturation")) push(RULED_OUT_FA.cpu, cpu, { cpuPct });
  const probe = obs.find((o) => o.kind === "probe" && paramNum(o, "ok") === 1 && paramNum(o, "slow") !== 1);
  if (probe) push(RULED_OUT_FA.availability, probe, { status: paramNum(probe, "status"), latencyMs: paramNum(probe, "latencyMs") });
  const current = obs.find((o) => o.summary === "evidence.release.current" && paramNum(o, "newestIsCurrent") === 1);
  if (current && !causes.has("build_failure")) push(RULED_OUT_FA.build, current, { tag: paramStr(current, "releaseTag") });
  const dbRunning = obs.find((o) => o.summary === "evidence.db.running");
  if (dbRunning) push(RULED_OUT_FA.db_stopped, dbRunning, { hostname: paramStr(dbRunning, "hostname") });
  return out.slice(0, 10);
}
