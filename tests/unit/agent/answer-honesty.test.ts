// Regression tests for the honesty review of the agent answer (H2). Before the fix: the model's raw summaryFa was
// the unlabelled HEADLINE («علت قطعی پیدا شد…» above «با شواهد فعلی نمی‌توان علت مشخصی…»), a model-only RAM
// hypothesis survived citing "memory normal" as SUPPORT, model text replaced a rule-backed explanation with
// «ری‌استارت حل می‌کند», and an all-sources-failed run read «نشانه‌ای از خطا دیده نشد».
import { describe, expect, it } from "vitest";
import { FindingSchema, type Finding } from "@/lib/contracts/hypothesis";
import { runAgent } from "@/lib/agent/orchestrate";
import { createMemoryIncidentSink } from "@/lib/agent/incident-port";
import { ANSWER_FA } from "@/lib/agent/fa-messages";
import { assertsCertainty, filterModelProse, recommendedActions } from "@/lib/agent/claims-filter";
import { INDICATIVE, type Cause } from "@/lib/evidence/levels";
import { createMemoryStore } from "@/lib/security/store";
import { agentLiara, capture, dataOf, fakeProbe, loadScenario, mockLlm, nowOf, TEST_TOKEN, textResult } from "./helpers";

async function run(name: string, text: string, synthesis: unknown, overrides: Record<string, number> = {}) {
  const s = loadScenario(name);
  const backend = agentLiara(s, overrides);
  const cap = capture();
  const llm = synthesis === null ? null : mockLlm({ synthesis: () => textResult(JSON.stringify(synthesis)) });
  await runAgent(
    { accountId: "acct_h2", text, history: [], target: { kind: "app", name: s.name } },
    { liara: backend.client, models: llm ? llm.models : null, knownSecrets: [TEST_TOKEN], store: createMemoryStore(), incidents: createMemoryIncidentSink(), probe: fakeProbe(s), now: nowOf(s) },
    cap.emit,
  );
  const finding = FindingSchema.parse(dataOf(cap, "data-finding")[0].data) as Finding;
  return { text: cap.text(), finding };
}
const hyp = (cause: string, supports: string[], titleFa = "علت قطعی: کمبود RAM", explanationFa = "ریشهٔ مشکل با قطعیت تأیید شد؛ حافظه تمام شده است.", actionHint = "resize") => ({
  titleFa,
  explanationFa,
  supports,
  contradicts: [],
  cause,
  actionHint,
});
const firstLine = (t: string) => t.split("\n")[0];
const CODE_HEADLINE_STARTS = [
  ANSWER_FA.topHeadline.split("{")[0],
  ANSWER_FA.errorsNoCauseHeadline,
  ANSWER_FA.healthyHeadline,
  ANSWER_FA.allFailedHeadline,
];
const isCodeHeadline = (line: string) => CODE_HEADLINE_STARTS.some((h) => line.startsWith(h));

describe("H2: the headline is built by code, model prose only in a labelled filtered block", () => {
  it("PoC A: healthy + fabricated ids + confident summary -> code headline; certainty sentences dropped", async () => {
    const { text, finding } = await run("healthy", "چرا سایت کند است؟", {
      hypotheses: [hyp("oom", ["O77", "O88"])],
      summaryFa: "علت قطعی پیدا شد: کمبود RAM. مشکل تأیید شده است و باید پلن را ارتقا دهید.",
      unknownsFa: [],
    });
    expect(finding.hypotheses).toEqual([]);
    expect(isCodeHeadline(firstLine(text))).toBe(true);
    expect(text).not.toContain("علت قطعی پیدا شد");
    expect(text).not.toContain("مشکل تأیید شده است");
    expect(text).not.toContain("پلن را ارتقا دهید");
    // the model block, when present, is labelled and comes after the three code-built sections
    const block = text.indexOf(ANSWER_FA.modelSummaryTitle);
    expect(block).toBeGreaterThan(text.indexOf(ANSWER_FA.unknown));
  });

  it("PoC B: cpu-bound, model blames RAM citing every fact -> the RAM hypothesis is dropped; memory_normal never supports RAM", async () => {
    const s0 = await run("cpu-bound-slow", "چرا سایت کند است؟", { hypotheses: [], summaryFa: "", unknownsFa: [] });
    const ids = s0.finding.facts.filter((o) => !o.flagged).map((o) => o.id);
    const { text, finding } = await run("cpu-bound-slow", "چرا سایت کند است؟", { hypotheses: [hyp("oom", ids)], summaryFa: "مشکل قطعاً کمبود RAM است.", unknownsFa: [] });
    expect(finding.hypotheses.map((h) => h.titleFa)).not.toContain("علت قطعی: کمبود RAM");
    const memNormal = finding.facts.filter((o) => o.summary === "evidence.metric.memory_normal").map((o) => o.id);
    expect(memNormal.length).toBeGreaterThan(0);
    for (const h of finding.hypotheses) for (const id of memNormal) expect(h.supports).not.toContain(id);
    expect(text).not.toContain("قطعاً کمبود RAM");
    expect(firstLine(text)).toContain("CPU");
  });

  it("PoC C: build failure -> rule explanation kept; «ری‌استارت حل می‌کند» never shown; model-only transient dropped", async () => {
    const s0 = await run("build-failure", "ریستارت کن", { hypotheses: [], summaryFa: "", unknownsFa: [] });
    const ruleExplanation = s0.finding.hypotheses[0].explanationFa;
    const ids = s0.finding.facts.filter((o) => !o.flagged).map((o) => o.id);
    const { text, finding } = await run("build-failure", "ریستارت کن", {
      hypotheses: [hyp("build_failure", ids, "خطای بیلد", "ری‌استارت حل می‌کند", "restart"), hyp("transient_unknown", ids, "موقت", "موقت است", "restart")],
      summaryFa: "با ری‌استارت حل می‌شود.",
      unknownsFa: [],
    });
    expect(finding.hypotheses[0].explanationFa.startsWith(ruleExplanation)).toBe(true);
    expect(finding.hypotheses[0].titleFa).toBe(s0.finding.hypotheses[0].titleFa);
    expect(text).not.toContain("ری‌استارت حل می‌کند");
    expect(text).not.toContain("با ری‌استارت حل می‌شود");
    expect(finding.hypotheses.map((h) => h.titleFa)).not.toContain("موقت");
  });

  it("all sources fail -> «نتوانستیم شواهدی جمع کنیم», limits say so; never «نشانه‌ای از خطا دیده نشد»", async () => {
    const fail = { logs: 500, logsV1: 500, applets: 500, releases: 500, events: 500, metricsSummary: 500, metricsCpu: 500, metricsMemory: 500, app: 500, me: 500 };
    const s = loadScenario("healthy");
    const cap = capture();
    await runAgent(
      { accountId: "a", text: "چرا سایت خطا می‌دهد؟", history: [], target: { kind: "app", name: s.name } },
      {
        liara: agentLiara(s, fail).client,
        models: null,
        knownSecrets: [TEST_TOKEN],
        store: createMemoryStore(),
        incidents: createMemoryIncidentSink(),
        probe: async () => {
          throw new Error("x");
        },
        now: nowOf(s),
      },
      cap.emit,
    );
    const text = cap.text();
    expect(firstLine(text)).toBe(ANSWER_FA.allFailedHeadline);
    expect(text).not.toContain(ANSWER_FA.healthyHeadline);
    expect(text).toContain(ANSWER_FA.allFailedNote);
    expect(text).not.toContain(ANSWER_FA.partialNote);
    const finding = FindingSchema.parse(dataOf(cap, "data-finding")[0].data);
    expect(finding.limitsNote?.[0]).toBe(ANSWER_FA.allFailedNote);
  });

  it("partial failure keeps the «بخشی از منابع» note and a code headline", async () => {
    const { text } = await run("healthy", "وضعیت سایت؟", null, { logs: 500, logsV1: 500 });
    expect(text).toContain(ANSWER_FA.partialNote);
    expect(text).not.toContain(ANSWER_FA.allFailedNote);
    expect(isCodeHeadline(firstLine(text))).toBe(true);
  });
});

describe("H2: claims filter", () => {
  it("drops certainty and unvalidated-action sentences, keeps hedged descriptive ones", () => {
    for (const s of ["علت قطعی پیدا شد.", "مشکل تأیید شده است.", "حتماً کمبود حافظه است.", "مطمئناً دیتابیس قطع است.", "علت اصلی کمبود RAM است.", "The root cause is OOM.", "This is definitely the DB."]) {
      expect(assertsCertainty(s), s).toBe(true);
    }
    expect(assertsCertainty("ممکن است علت کمبود حافظه باشد.")).toBe(false);
    expect(recommendedActions("با ری‌استارت حل می‌شود.")).toEqual(["restart"]);
    expect(recommendedActions("باید پلن را ارتقا دهید.")).toEqual(["resize"]);
    const r = filterModelProse("ممکن است حافظه کم باشد. با ری‌استارت حل می‌شود. باید پلن را ارتقا دهید.", ["resize"]);
    expect(r.text).toBe("ممکن است حافظه کم باشد. باید پلن را ارتقا دهید.");
    expect(r.dropped).toBe(1);
  });
});

describe("H2: fuzz — a mock model returning confident garbage never reaches the headline or support lists", () => {
  const CONFIDENT = [
    "علت قطعی پیدا شد",
    "مشکل تأیید شده است",
    "حتماً باید ری‌استارت کنید",
    "مطمئناً حافظه تمام شده",
    "The root cause is the database",
    "This is definitely fixed by a restart",
    "علت اصلی مشکل پورت اشتباه است",
    "با ارتقای پلن برطرف می‌شود",
  ];
  const CAUSES: Cause[] = ["missing_env", "wrong_port", "crash_after_release", "build_failure", "db_unreachable", "oom", "cpu_saturation", "external_dependency", "transient_unknown"];
  const SCEN = ["healthy", "cpu-bound-slow", "build-failure", "missing-env", "oom", "wrong-port", "db-unreachable", "crash-loop"];
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };

  it("30 random runs", async () => {
    for (let i = 0; i < 30; i++) {
      const name = SCEN[rnd(SCEN.length)];
      const marker = (k: number) => `ZQ${i}x${k}`;
      const garbage = Array.from({ length: 3 }, (_, k) => `${CONFIDENT[rnd(CONFIDENT.length)]} ${marker(k)}.`).join(" ");
      const benign = `شاید مشکل موقتی باشد BENIGN${i}.`;
      const ids = Array.from({ length: 1 + rnd(6) }, () => `O${1 + rnd(14)}`);
      const cause = CAUSES[rnd(CAUSES.length)];
      const { text, finding } = await run(name, "چرا سایت خطا می‌دهد؟", {
        hypotheses: [hyp(cause, ids, `${CONFIDENT[rnd(CONFIDENT.length)]} ${marker(9)}`, garbage, "restart")],
        summaryFa: `${garbage} ${benign}`,
        unknownsFa: [garbage],
      });
      expect(isCodeHeadline(firstLine(text)), `${name}: ${firstLine(text)}`).toBe(true);
      for (let k = 0; k < 10; k++) expect(text, `${name} leaked ${marker(k)}`).not.toContain(marker(k));
      expect(text).toContain(`BENIGN${i}`);
      expect(text.indexOf(`BENIGN${i}`)).toBeGreaterThan(text.indexOf(ANSWER_FA.modelSummaryTitle));
      // every surviving hypothesis of this cause that is not rule-backed cites at least one indicative observation
      const byId = new Map(finding.facts.map((o) => [o.id, o]));
      for (const h of finding.hypotheses) {
        if (!h.titleFa.includes(marker(9))) continue;
        expect(h.supports.some((id) => byId.get(id) && INDICATIVE[cause](byId.get(id)!))).toBe(true);
      }
    }
  }, 60_000);
});
