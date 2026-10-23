import { describe, expect, it } from "vitest";
import { deriveEvidenceLevel, FindingSchema } from "@/lib/contracts/hypothesis";
import { ProposalSchema, type Proposal } from "@/lib/contracts/proposal";
import { AI_PROPOSABLE_ACTION_TYPES } from "@/lib/contracts/action";
import { runAgent, type AgentDeps } from "@/lib/agent/orchestrate";
import { ANSWER_FA } from "@/lib/agent/fa-messages";
import { createMemoryIncidentSink } from "@/lib/agent/incident-port";
import { createMemoryStore } from "@/lib/security/store";
import { agentLiara, capture, dataOf, fakeProbe, loadScenario, nowOf, SCENARIOS, TEST_TOKEN, type MockLlm } from "./helpers";

export async function runScenario(name: string, text: string, opts: { llm?: MockLlm | null; overrides?: Record<string, number>; patch?: Record<string, unknown>; target?: boolean } = {}) {
  const s = loadScenario(name);
  const backend = agentLiara(s, opts.overrides ?? {}, opts.patch ?? {});
  const store = createMemoryStore();
  const incidents = createMemoryIncidentSink();
  const cap = capture();
  const deps: AgentDeps = { liara: backend.client, models: opts.llm?.models ?? null, knownSecrets: [TEST_TOKEN], store, incidents, probe: fakeProbe(s), now: nowOf(s) };
  const summary = await runAgent({ accountId: "acct_test", text, history: [], ...(opts.target === false ? {} : { target: { kind: "app" as const, name: s.name } }) }, deps, cap.emit);
  const proposals = await store.proposals.list("acct_test");
  return { s, backend, cap, summary, proposals, incidents };
}

async function runWithProbe() {
  const s = loadScenario("healthy");
  const backend = agentLiara(s);
  const store = createMemoryStore();
  const cap = capture();
  const probe = async () => ({ ok: false, status: 500, latencyMs: 300, checkedAt: s.now });
  await runAgent({ accountId: "acct_test", text: "سایت باز نمی‌شود", history: [], target: { kind: "app", name: s.name } }, { liara: backend.client, models: null, knownSecrets: [TEST_TOKEN], store, incidents: createMemoryIncidentSink(), probe, now: nowOf(s) }, cap.emit);
  return { proposals: await store.proposals.list("acct_test"), cap };
}

const findingOf = (r: Awaited<ReturnType<typeof runScenario>>) => FindingSchema.parse(dataOf(r.cap, "data-finding")[0].data);

describe("rule-only pipeline (no LLM)", () => {
  it("emits parts in a stable order with stable ids", async () => {
    const r = await runScenario("missing-env", "چرا سایت demo-shop خطای ۵۰۰ می‌دهد؟");
    const order = r.cap.chunks.map((c) => `${c.type}${"id" in c && c.id ? `#${c.id}` : ""}`);
    const firstIdx = (p: string) => order.findIndex((x) => x.startsWith(p));
    expect(order[0]).toBe("data-step#intent");
    expect(firstIdx("data-step#target")).toBeLessThan(firstIdx("data-step#collect"));
    expect(firstIdx("data-step#collect")).toBeLessThan(firstIdx("data-observation"));
    expect(firstIdx("data-observation")).toBeLessThan(firstIdx("data-step#synthesis"));
    expect(firstIdx("data-error#error-llm_unavailable")).toBeLessThan(firstIdx("data-finding#finding"));
    expect(firstIdx("data-finding#finding")).toBeLessThan(firstIdx("data-proposal"));
    expect(firstIdx("data-proposal")).toBeLessThan(firstIdx("data-incident"));
    expect(firstIdx("data-incident")).toBeLessThan(firstIdx("text-start#answer"));
    expect(order[order.length - 1]).toBe("text-end#answer");
    // Step updates reuse the same id (running -> done) so the UI updates in place.
    const collect = dataOf(r.cap, "data-step").filter((d) => d.id === "collect").map((d) => d.data.status);
    expect(collect).toEqual(["running", "done"]);
    // Every observation id is emitted once and matches its data id.
    const obs = dataOf(r.cap, "data-observation");
    expect(new Set(obs.map((o) => o.id)).size).toBe(obs.length);
    for (const o of obs) expect(o.id).toBe(o.data.id);
    expect(r.backend.mutations).toEqual([]);
  });

  it.each(SCENARIOS)("scenario %s: finding valid, levels derived, proposals allowlisted and cited", async (name) => {
    const r = await runScenario(name, "چرا سایت خراب است؟");
    const f = findingOf(r);
    const ids = new Set(f.facts.map((o) => o.id));
    for (const h of f.hypotheses) {
      for (const id of [...h.supports, ...h.contradicts]) expect(ids.has(id)).toBe(true);
      expect(h.level).toBe(deriveEvidenceLevel({ ...h.levelReason, supported: h.supports.length > 0 }));
    }
    expect(r.proposals.length).toBeLessThanOrEqual(1);
    for (const p of r.proposals) {
      expect(ProposalSchema.safeParse(p).success).toBe(true);
      expect(AI_PROPOSABLE_ACTION_TYPES).toContain(p.type);
      expect(p.source).toBe("agent");
      expect(p.evidenceIds.length).toBeGreaterThan(0);
      for (const id of p.evidenceIds) expect(ids.has(id)).toBe(true);
    }
    expect(r.backend.mutations).toEqual([]);
    const text = r.cap.text();
    expect(text).toContain("مشاهده‌شده:");
    expect(text).toContain("برداشت:");
    expect(text).toContain("نامشخص:");
  });

  it("is deterministic on the rule-only path", async () => {
    // Only random ids (proposal, incident, idempotency key) may differ between runs.
    const strip = (r: Awaited<ReturnType<typeof runScenario>>) => JSON.stringify(r.cap.chunks).replace(/\b(?:p|inc|idk)_[A-Za-z0-9_-]+/g, "<id>");
    const a = await runScenario("wrong-port", "سایت بالا نمی‌آید");
    const b = await runScenario("wrong-port", "سایت بالا نمی‌آید");
    expect(strip(a)).toBe(strip(b));
  });
});

describe("cause -> action mapping (code, not model)", () => {
  const prop = (r: { proposals: Proposal[] }) => r.proposals[0];

  it("missing env -> set_env with a key from evidence and no value anywhere", async () => {
    const r = await runScenario("missing-env", "سایت خطای ۵۰۰ می‌دهد");
    const p = prop(r);
    expect(p?.type).toBe("set_env");
    if (p?.params.type !== "set_env") throw new Error("expected set_env");
    const change = p.params.changes[0];
    expect(change.op).toBe("set");
    expect(JSON.stringify(p)).not.toMatch(/"value"\s*:/);
    expect(dataOf(r.cap, "data-proposal")[0].data).toEqual(p);
  });

  it("wrong port -> update_port with the port detected in logs", async () => {
    const r = await runScenario("wrong-port", "سایت بالا نمی‌آید");
    const p = prop(r);
    expect(p?.type).toBe("update_port");
    if (p?.params.type !== "update_port") throw new Error("expected update_port");
    const f = findingOf(r);
    const listen = f.facts.find((o) => o.summary === "evidence.port.listen_differs");
    expect(p.params.port).toBe(listen?.params.listenPort);
  });

  it.each(["build-failure", "crash-loop"])("%s -> no proposal, developer block instead", async (name) => {
    const r = await runScenario(name, "چرا سایت خراب شد؟");
    expect(r.proposals).toEqual([]);
    expect(dataOf(r.cap, "data-proposal")).toEqual([]);
    expect(r.cap.text()).toContain("آنچه توسعه‌دهنده باید اصلاح کند");
    for (const h of findingOf(r).hypotheses) expect(h.actionHint).not.toBe("redeploy_previous");
  });

  it("db stopped -> scale the database up", async () => {
    const r = await runScenario("db-stopped", "اتصال به دیتابیس برقرار نمی‌شود");
    const p = prop(r);
    expect(p?.type).toBe("scale");
    if (p?.params.type !== "scale") throw new Error("expected scale");
    expect(p.params.resource.kind).toBe("db");
    expect(p.params.scale).toBe(1);
  });

  it("restart is proposed only when no deterministic error signature explains the failure", async () => {
    for (const name of SCENARIOS) {
      const r = await runScenario(name, "سایت مشکل دارد");
      if (r.proposals[0]?.type !== "restart") continue;
      const signed = findingOf(r).hypotheses.filter((h) => h.levelReason.signature);
      expect(signed.every((h) => /OOM/.test(h.titleFa)), name).toBe(true);
    }
  });

  // Changed 2026-10-23: an unexplained failing probe is weak evidence; it used to yield a restart proposal. Weak or
  // insufficient findings now produce no proposal, only the "collect more evidence" note.
  it("transient failure (probe fails, no error signature) -> no proposal, asks for more evidence", async () => {
    const r = await runScenario("healthy", "سایت باز نمی‌شود");
    expect(r.proposals).toEqual([]);
    const t = await runWithProbe();
    expect(t.proposals).toEqual([]);
    expect(t.cap.text()).toContain(ANSWER_FA.collectMoreEvidence);
  });

  it("resize carries a cost estimate from the plan list", async () => {
    const s = loadScenario("cpu-bound-slow");
    const me = {
      plans: {
        projects: {
          "iran-g2-small": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5, price: 120 },
          "iran-g2-medium": { available: true, region: "iran", RAM: { amount: 2 }, CPU: { amount: 2 }, volume: 10, price: 240 },
          "iran-g2-large": { available: true, region: "iran", RAM: { amount: 4 }, CPU: { amount: 4 }, volume: 20, price: 480 },
        },
        projectBundlePlans: {},
      },
    };
    const r = await runScenario("cpu-bound-slow", "سایت خیلی کند است", { patch: { me } });
    const p = prop(r);
    expect(s.name).toBeTruthy();
    expect(p?.type).toBe("resize");
    if (p?.params.type !== "resize") throw new Error("expected resize");
    expect(p.params.planId).toBe("iran-g2-medium");
    expect(p.costEstimate).toEqual({ perHourToman: 240, perMonthToman: 240 * 720 });
  });

  it("resize is never proposed (nor costed as 0) when the bigger plans have no price in /v1/me", async () => {
    const me = {
      plans: {
        projects: {
          "iran-g2-small": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5, price: 120 },
          "iran-g2-medium": { available: true, region: "iran", RAM: { amount: 2 }, CPU: { amount: 2 }, volume: 10 },
          "iran-g2-large": { available: true, region: "iran", RAM: { amount: 4 }, CPU: { amount: 4 }, volume: 20, price: 0 },
        },
        projectBundlePlans: {},
      },
    };
    const r = await runScenario("cpu-bound-slow", "سایت خیلی کند است", { patch: { me } });
    expect(r.proposals.some((p) => p.type === "resize")).toBe(false);
    expect(r.proposals.every((p) => p.costEstimate === undefined || p.costEstimate.perHourToman > 0)).toBe(true);
  });

  it("healthy app -> no proposal, no incident", async () => {
    const r = await runScenario("healthy", "وضعیت سایت چطور است؟");
    expect(r.proposals).toEqual([]);
    expect(dataOf(r.cap, "data-incident")).toEqual([]);
  });
});

describe("direct action requests", () => {
  it("«ریستارت کن» on a config bug: evidence first, restart refused honestly, better action proposed", async () => {
    const r = await runScenario("missing-env", "برنامه را ریستارت کن");
    expect(r.summary.intent).toBe("action_request");
    expect(dataOf(r.cap, "data-observation").length).toBeGreaterThan(0);
    const p = r.proposals[0];
    expect(p?.type).not.toBe("restart");
    expect(p?.type).toBe("set_env");
    expect(r.cap.text()).toContain("به جای اقدام درخواستی");
  });

  it("«ریستارت کن» on a build failure: no proposal and says restart will not help", async () => {
    const r = await runScenario("build-failure", "ریستارت کن");
    expect(r.proposals).toEqual([]);
    expect(r.cap.text()).toContain("مشکل را حل نمی‌کند");
  });

  it("«ریستارت کن» on a healthy app: restart proposed with evidence ids", async () => {
    const r = await runScenario("healthy", "لطفاً برنامه را ریستارت کن");
    const p = r.proposals[0];
    expect(p?.type).toBe("restart");
    expect(p?.evidenceIds.length).toBeGreaterThan(0);
  });
});

describe("partial evidence", () => {
  it("failed sources are reported as failed steps and the answer says evidence is incomplete", async () => {
    const r = await runScenario("partial-failure", "سایت خطا می‌دهد");
    const failed = dataOf(r.cap, "data-step").filter((d) => String(d.id).startsWith("src-") && d.data.status === "failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(r.cap.text()).toContain("بخشی از منابع شواهد در دسترس نبود");
    expect(findingOf(r).limitsNote?.join(" ")).toContain("ناقص");
  });
});

describe("target resolution", () => {
  it("resolves a name mentioned in the text against the user's own apps", async () => {
    const r = await runScenario("missing-env", "چرا demo-shop خطا می‌دهد؟", { target: false });
    expect(r.summary.target).toEqual({ kind: "app", name: "demo-shop" });
  });

  it("asks which service when nothing identifies one", async () => {
    const r = await runScenario("missing-env", "چرا سایت خطا می‌دهد؟", { target: false });
    expect(r.summary.target).toBeUndefined();
    expect(dataOf(r.cap, "data-observation")).toEqual([]);
    expect(r.cap.text()).toContain("کدام سرویس");
  });

  it("asks when several services are mentioned", async () => {
    const r = await runScenario("missing-env", "demo-shop یا other-app خطا می‌دهد؟", { target: false });
    expect(r.summary.target).toBeUndefined();
    expect(r.cap.text()).toContain("other-app");
  });

  it("rejects a body target that is not one of the user's services (no evidence read)", async () => {
    const s = loadScenario("missing-env");
    const backend = agentLiara(s);
    const cap = capture();
    await runAgent({ accountId: "acct_t", text: "چرا خطا می‌دهد؟", history: [], target: { kind: "app", name: "someone-else" } }, { liara: backend.client, models: null, knownSecrets: [TEST_TOKEN], store: createMemoryStore(), incidents: createMemoryIncidentSink(), probe: fakeProbe(s), now: nowOf(s) }, cap.emit);
    expect(backend.calls.every((c) => c === "GET /v1/projects" || c === "GET /v1/databases")).toBe(true);
    expect(cap.text()).toContain("پیدا نشد");
  });
});
