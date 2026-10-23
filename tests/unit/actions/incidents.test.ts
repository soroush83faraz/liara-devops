// Incidents: lifecycle, redaction, linkage to the job, and a Markdown export that cannot be turned into links,
// images, HTML or headings by model-written or log text. Synthetic data only.
import { describe, expect, it } from "vitest";
import { handleIncidentMarkdown } from "../../../lib/actions/http/incidents";
import { handleApprove, handleExecute } from "../../../lib/actions/http/proposals";
import {
  attachProposal,
  attachVerification,
  createIncident,
  findIncidentByProposal,
  getIncident,
  recordIncidentEvent,
  renderIncidentMarkdown,
  resolveIncident,
  storeIncidentSink,
} from "../../../lib/actions/incidents";
import type { Finding } from "../../../lib/contracts/hypothesis";
import type { Incident, IncidentTimelineEntry } from "../../../lib/contracts/proposal";
import { body, ctxFor, propose, setup } from "./helpers";

const SECRET = "hunter2-SYNTHETIC-Pw-9876";

function finding(over: Partial<Finding["hypotheses"][number]> = {}, factText = "Error: SESSION_SECRET is not defined"): Finding {
  return {
    facts: [{ id: "O1", kind: "missing_env", severity: "error", source: "liara:logs", summary: "obs.missing_env", text: factText, params: { key: "SESSION_SECRET" } }],
    hypotheses: [
      {
        id: "H1",
        titleFa: "متغیر محیطی وجود ندارد",
        explanationFa: "اپ به متغیر نیاز دارد.",
        supports: ["O1"],
        contradicts: [],
        level: "medium",
        levelReason: { rule: "missing_env", signature: true, correlation: false, contradicted: false },
        ...over,
      },
    ],
    ruledOut: [],
    unknowns: [{ descriptionFa: "لاگ‌های قدیمی‌تر در دسترس نیست" }],
  };
}

describe("incident lifecycle", () => {
  it("create -> attach proposal -> verification -> resolve, free text redacted before storage", async () => {
    const env = setup();
    const created = await createIncident(env.store, env.accountId, {
      target: { kind: "app", name: "shop" },
      finding: finding({ explanationFa: `رمز password=${SECRET} در لاگ دیده شد` }, `db login failed password=${SECRET}`),
    });
    const raw = JSON.stringify(await getIncident(env.store, env.accountId, created.id));
    expect(raw).not.toContain(SECRET);
    expect(created.timeline.map((t) => t.kind)).toEqual(["detected", "investigated"]);

    await attachProposal(env.store, env.accountId, created.id, { id: "p_abc" });
    await recordIncidentEvent(env.store, env.accountId, created.id, "executing", { refId: "p_abc" });
    const verification = { checks: [{ name: "probe_2xx", passed: true, detail: "3 probes" }], outcome: "verified" as const };
    await attachVerification(env.store, env.accountId, created.id, verification, { proposalId: "p_abc" });
    const resolved = await resolveIncident(env.store, env.accountId, created.id);
    expect(resolved?.proposalId).toBe("p_abc");
    expect(resolved?.verification?.outcome).toBe("verified");
    expect(resolved?.resolvedAt).toBeDefined();
    expect(resolved?.timeline.map((t) => t.kind)).toEqual(["detected", "investigated", "proposed", "executing", "verified", "resolved"]);
    expect((await resolveIncident(env.store, env.accountId, created.id))?.resolvedAt).toBe(resolved?.resolvedAt);
    expect((await findIncidentByProposal(env.store, env.accountId, "p_abc"))?.id).toBe(created.id);
  });

  it("store-backed sink matches the agent's IncidentSink shape", async () => {
    const env = setup();
    const sink = storeIncidentSink(env.store);
    const timeline: IncidentTimelineEntry[] = [{ ts: "2026-10-22T08:00:00.000Z", kind: "detected", textFa: `token=${SECRET}` }];
    const { incidentId } = await sink.create(env.accountId, { target: { kind: "app", name: "shop" }, finding: finding(), startedAt: "2026-10-22T08:00:00.000Z", timeline, proposalId: "p_x" });
    const stored = await getIncident(env.store, env.accountId, incidentId);
    expect(sink.durable).toBe(true);
    expect(stored?.proposalId).toBe("p_x");
    expect(JSON.stringify(stored)).not.toContain(SECRET);
  });

  it("a linked incident receives the job's verification and is resolved when verified", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const p = await propose(env, { type: "restart", app: "shop" });
    const inc = await createIncident(env.store, env.accountId, { target: { kind: "app", name: "shop" }, finding: finding(), proposalId: p.id });
    // The cited error's absence must be shown over a NON-EMPTY log window after the change.
    env.liara.log("shop", "listening on :3000", env.clock.now() + 60_000);
    const { approvalToken } = await body<{ approvalToken: string }>(await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps));
    await handleExecute(ctxFor(env, { body: { approvalToken } }), p.id, env.deps);
    await env.settle();
    const after = (await getIncident(env.store, env.accountId, inc.id)) as Incident;
    expect(after.verification?.outcome).toBe("verified");
    expect(after.resolvedAt).toBeDefined();
    expect(after.timeline.map((t) => t.kind)).toEqual(expect.arrayContaining(["executing", "executed", "verified", "resolved"]));
  });
});

/** Lines of the document that are outside fenced code blocks. */
function proseLines(md: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of md.split("\n")) {
    const m = /^(`{3,})/.exec(line);
    if (m && (fence === null || m[1] === fence)) {
      fence = fence === null ? m[1] : null;
      continue;
    }
    if (fence === null) out.push(line);
  }
  return out;
}

describe("renderIncidentMarkdown", () => {
  const evil = finding(
    {
      titleFa: "خطا [click](javascript:alert(1)) <img src=x onerror=alert(1)> **bold**",
      explanationFa: `# Injected heading\n- injected item\n![x](https://evil.example/p.png) visit https://evil.example and www.evil.example token=${SECRET}`,
    },
    "line1\n```\n# not a heading\n<script>alert(1)</script>\n````",
  );

  it("escapes markup, defangs URLs, fences excerpts and redacts secrets", async () => {
    const env = setup();
    const inc = await createIncident(env.store, env.accountId, {
      target: { kind: "app", name: "shop" },
      finding: evil,
      timeline: [{ ts: "2026-10-22T08:00:00.000Z", kind: "note", textFa: "<b>bold</b> [x](http://e.example)" }],
    });
    const md = renderIncidentMarkdown(inc);
    const prose = proseLines(md).join("\n");
    expect(md).not.toContain(SECRET);
    expect(prose).not.toMatch(/\]\(/); // no link/image syntax survives
    expect(prose).not.toMatch(/(^|[^\\])</); // every "<" is escaped
    expect(prose).not.toMatch(/^#+ Injected/m);
    expect(prose).not.toMatch(/^- injected/m);
    expect(prose).not.toContain("https://evil.example");
    expect(prose).not.toContain("www.evil.example");
    expect(prose).toContain("\\[click\\]\\(javascript\\:alert\\(1\\)\\)");
    expect(prose).toContain("https\\[\\:\\]//evil\\.example");
    // The excerpt is inert inside a fence longer than any backtick run it contains.
    expect(md).toMatch(/^`{5}text$/m);
    expect(prose).not.toContain("<script>");
    expect(prose.split("\n").some((l) => l.startsWith("# not a heading"))).toBe(false);
  });

  it("is served as text/markdown with nosniff and a sandboxing CSP", async () => {
    const env = setup();
    const inc = await createIncident(env.store, env.accountId, { target: { kind: "app", name: "shop" }, finding: evil });
    const res = await handleIncidentMarkdown(ctxFor(env, { method: "GET" }), inc.id, env.deps);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).not.toContain(SECRET);
    const other = { ...env, accountId: "acct_other_reader" };
    expect((await handleIncidentMarkdown(ctxFor(other, { method: "GET" }), inc.id, env.deps)).status).toBe(404);
  });
});
