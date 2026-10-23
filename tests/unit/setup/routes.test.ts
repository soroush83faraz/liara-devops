// Route-level tests with a faked session and faked Liara reads (NO network). Proves handler behaviour, not Liara support.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { fixture, zipOf } from "./helpers";
import meFixture from "../../fixtures/liara/me.synthetic.json";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "setup-routes-"));

// A fresh account per test keeps the per-account rate limiter out of the way.
const state = vi.hoisted(() => ({ n: 0, account: "acct_routes_0" }));

vi.mock("@/lib/session", async (orig) => {
  const actual = await orig<typeof import("@/lib/session")>();
  return { ...actual, requireSession: async () => ({ token: "tok_SYNTHETIC", accountId: state.account, teamId: undefined }) };
});
// The real fingerprint reads Liara; keep this suite offline with a constant (fingerprint logic is tested in tests/unit/actions).
vi.mock("@/lib/actions/fingerprint", () => ({ computeTargetFingerprint: async () => "a".repeat(64) }));
vi.mock("@/lib/liara", async (orig) => {
  const actual = await orig<typeof import("@/lib/liara")>();
  return {
    ...actual,
    getMe: async () => actual.MeSchema.parse(meFixture),
    listNetworks: async () => [{ _id: "net1", name: "main-net", createdAt: "2026-01-01T00:00:00Z" }],
    listApps: async () => [{ _id: "a1", project_id: "taken-name" }],
    listDatabases: async () => [{ _id: "d1", hostname: "taken-db" }],
  };
});

type Handler = (req: Request) => Promise<Response>;
let analyze: Handler;
let plan: Handler;
const SENTINELS = ["FAKE_PASSWORD_VALUE", "FAKE_SECRET_VALUE_123", "sk_test_FAKE_VALUE"];

beforeEach(() => {
  state.account = `acct_routes_${++state.n}`;
});

beforeAll(async () => {
  analyze = (await import("@/app/api/setup/analyze/route")).POST as Handler;
  plan = (await import("@/app/api/setup/plan/route")).POST as Handler;
});

const upload = (bytes: Uint8Array, name = "shop.zip") => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  return new Request("http://localhost/api/setup/analyze", { method: "POST", body: form });
};
const json = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const choices = (over: Record<string, unknown> = {}) => ({
  appName: "my-shop",
  planId: "iran-g2-small",
  includeDb: true,
  dbEngine: "postgres",
  dbPlanId: "iran-g2-small",
  networkId: "net1",
  envChoices: [
    { name: "NEXTAUTH_SECRET", valueSource: "generated" },
    { name: "STRIPE_SECRET_KEY", valueSource: "user" },
  ],
  ...over,
});

describe("POST /api/setup/analyze", () => {
  it("analyses a zip, stores it, recommends a plan, and never echoes contents", async () => {
    const res = await analyze(upload(zipOf(fixture("nextjs"))));
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const s of SENTINELS) expect(text).not.toContain(s);
    const body = JSON.parse(text);
    expect(body.sourceRef).toMatch(/^[0-9a-f]{32}$/);
    expect(body).toMatchObject({ fileName: "shop.zip", format: "zip", analysis: { platform: "next" } });
    expect(body.recommendation.platform).toBe("next");
    expect(body.recommendation.notes).toContain("plan_below_need");
    expect(body.catalog.appPlans.map((p: { id: string }) => p.id)).toEqual(["free", "iran-g2-small"]);
    expect(body.catalog.networks).toEqual([{ id: "net1", name: "main-net" }]);
  });

  it("rejects unsupported content types and oversized declared lengths", async () => {
    const bad = await analyze(new Request("http://localhost/api/setup/analyze", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" }));
    expect(bad.status).toBe(415);
    const big = await analyze(
      new Request("http://localhost/api/setup/analyze", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(300 * 1024 * 1024) }, body: "x" }),
    );
    expect(big.status).toBe(413);
  });

  it("maps archive guard failures to safe 4xx errors", async () => {
    const slip = await analyze(upload(zipSync({ "../evil": strToU8("x"), "package.json": strToU8("{}") })));
    expect(slip.status).toBe(422);
    expect((await slip.json()).error.code).toBe("unsafe_path");
    const junk = await analyze(upload(strToU8("this is not an archive")));
    expect(junk.status).toBe(415);
    expect((await junk.json()).error.code).toBe("unsupported_format");
    const none = await analyze(new Request("http://localhost/api/setup/analyze", { method: "POST", body: new FormData() }));
    expect(none.status).toBe(400);
  });

  it("no-file path: fixed questions first, then an analysis from the answers only", async () => {
    const q = await analyze(json("/api/setup/analyze", { description: "یک فروشگاه ساده" }));
    expect((await q.json()).questions.map((x: { id: string }) => x.id)).toEqual(["platform", "database", "port", "dockerImage", "envNames"]);
    const a = await analyze(json("/api/setup/analyze", { answers: { platform: "flask", database: "postgres", port: 5000, envNames: ["SECRET_KEY"] } }));
    const body = await a.json();
    expect(body.sourceRef).toBeUndefined();
    expect(body.analysis).toMatchObject({ platform: "flask", port: 5000, confidence: 1 });
    expect(body.analysis.requiresDatabase[0].engine).toBe("postgres");
    const bad = await analyze(json("/api/setup/analyze", { answers: { platform: "cobol" } }));
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/setup/plan", () => {
  async function uploaded(): Promise<string> {
    const res = await analyze(upload(zipOf(fixture("nextjs"))));
    return (await res.json()).sourceRef as string;
  }

  it("builds a deploy_plan proposal for source 'setup' and persists it", async () => {
    const sourceRef = await uploaded();
    const res = await plan(json("/api/setup/plan", { sourceRef, choices: choices() }));
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const s of SENTINELS) expect(text).not.toContain(s);
    const body = JSON.parse(text);
    expect(body.plan.steps.map((s: { kind: string }) => s.kind)).toEqual(["create_app", "create_db", "set_env", "wire_db", "deploy", "domain_guidance"]);
    expect(body.userValueKeys).toEqual(["STRIPE_SECRET_KEY"]);
    expect(body.costs.totals.perHourToman).toBeCloseTo(100 + 0.5, 5);
    expect(body.explanation.summary).toContain("my-shop");

    const { getDefaultStore } = await import("@/lib/security");
    const stored = await getDefaultStore().proposals.get(state.account, body.proposalId);
    expect(stored).toMatchObject({ type: "deploy_plan", source: "setup", status: "proposed", evidenceIds: [] });
    expect(stored?.costEstimate?.perMonthToman).toBe(body.costs.totals.perMonthToman);
    expect(JSON.stringify(stored)).not.toContain("FAKE_");
  });

  it("re-validates against the account: unknown plan, taken names, expired source", async () => {
    const sourceRef = await uploaded();
    const unknown = await plan(json("/api/setup/plan", { sourceRef, choices: choices({ planId: "nope" }) }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatchObject({ code: "unknown_plan", field: "planId" });
    const taken = await plan(json("/api/setup/plan", { sourceRef, choices: choices({ appName: "taken-name" }) }));
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("app_exists");
    const dbTaken = await plan(json("/api/setup/plan", { sourceRef, choices: choices({ dbName: "taken-db" }) }));
    expect((await dbTaken.json()).error.code).toBe("db_exists");
    const gone = await plan(json("/api/setup/plan", { sourceRef: "0123456789abcdef0123456789abcdef", choices: choices() }));
    expect(gone.status).toBe(410);
  });

  it("rejects malformed bodies, values smuggled into env choices, and wrong content types", async () => {
    const sourceRef = await uploaded();
    const smuggle = await plan(json("/api/setup/plan", { sourceRef, choices: choices({ envChoices: [{ name: "A_B", valueSource: "user", value: "hunter2" }] }) }));
    expect(smuggle.status).toBe(400);
    const wrongType = await plan(new Request("http://localhost/api/setup/plan", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
    expect(wrongType.status).toBe(415);
    const noSource = await plan(json("/api/setup/plan", { choices: choices() }));
    expect(noSource.status).toBe(400);
  });

  it("description path: needs an image to deploy, then works without a stored archive", async () => {
    const a = await (await analyze(json("/api/setup/analyze", { answers: { platform: "flask", port: 5000 } }))).json();
    const noImage = await plan(json("/api/setup/plan", { analysis: a.analysis, choices: choices({ includeDb: false, networkId: undefined }) }));
    expect((await noImage.json()).error.code).toBe("no_deploy_source");
    const ok = await plan(json("/api/setup/plan", { analysis: a.analysis, choices: choices({ includeDb: false, networkId: undefined, dockerImage: "registry.example.invalid/app:1" }) }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.plan.steps.find((s: { kind: string }) => s.kind === "deploy").source).toMatchObject({ kind: "image" });
  });
});
