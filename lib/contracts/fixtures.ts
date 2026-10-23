/**
 * SYNTHETIC sample data for UI development, stories and tests.
 * Nothing here was recorded from Liara; names, ids, prices and log lines are made up.
 * Every object is validated against its schema by tests/unit/contracts/fixtures.test.ts,
 * which also re-computes the pinned hashes below.
 */
import { statusCode } from "../i18n/bidi";
import { costFromHourly } from "./common";
import type { ActionParamsOf } from "./action";
import type { DeployPlan } from "./deploy-plan";
import type { Finding } from "./hypothesis";
import type { Observation } from "./observation";
import type { Incident, Proposal, ProposalStatus, Verification } from "./proposal";
import type { CopilotDataStreamEvent, CopilotStreamEvent, ErrorData } from "./stream";

export const SYNTHETIC_NOTICE = "SYNTHETIC sample data — not recorded from Liara" as const;

export const FIXTURE_ACCOUNT_ID = "acct_demo";

/* ---------------------------------------------------------- observations */

export const failingObservations: Observation[] = [
  {
    id: "O1",
    kind: "missing_env",
    severity: "error",
    ts: "2026-10-22T07:58:12.000Z",
    source: "liara:logs",
    summary: "obs.missing_env",
    text: "Error: SESSION_SECRET is not defined\n    at createSession (/app/server.js:42:11)",
    params: { key: "SESSION_SECRET", count: 37 },
  },
  {
    id: "O2",
    kind: "http_status",
    severity: "error",
    ts: "2026-10-22T07:58:30.000Z",
    source: "probe",
    summary: "obs.http_status",
    text: "GET https://broken-shop.liara.run/ -> 500 (312 ms)",
    params: { status: 500, url: "https://broken-shop.liara.run/" },
  },
  {
    id: "O3",
    kind: "release_state",
    severity: "info",
    ts: "2026-10-22T07:41:05.000Z",
    source: "liara:releases",
    summary: "obs.release_state",
    text: "release rel_demo_0002 READY",
    params: { releaseId: "rel_demo_0002", state: "READY" },
  },
  {
    id: "O4",
    kind: "config",
    severity: "warn",
    ts: "2026-10-22T07:55:40.000Z",
    source: "liara:app",
    summary: "obs.env_key_removed",
    text: "env key SESSION_SECRET no longer present",
    params: { key: "SESSION_SECRET", minutesBeforeOnset: 3 },
  },
  {
    id: "O5",
    kind: "applet_state",
    severity: "info",
    ts: "2026-10-22T07:58:31.000Z",
    source: "liara:applets",
    summary: "obs.applet_state",
    text: "applet broken-shop-7c9f state=RUNNING restarts=0",
    params: { state: "RUNNING", restarts: 0 },
  },
];

export const healthyObservations: Observation[] = [
  {
    id: "O1",
    kind: "probe",
    severity: "info",
    ts: "2026-10-22T08:10:00.000Z",
    source: "probe",
    summary: "obs.probe_ok",
    text: "GET https://broken-shop.liara.run/ -> 200 (84 ms)",
    params: { status: 200, latencyMs: 84 },
  },
  {
    id: "O2",
    kind: "release_state",
    severity: "info",
    ts: "2026-10-22T07:41:05.000Z",
    source: "liara:releases",
    summary: "obs.release_state",
    text: "release rel_demo_0002 READY",
    params: { releaseId: "rel_demo_0002", state: "READY" },
  },
  {
    id: "O3",
    kind: "metric",
    severity: "info",
    ts: "2026-10-22T08:09:00.000Z",
    source: "liara:metrics",
    summary: "obs.memory_usage",
    text: "memory 41% of limit (avg 15 min)",
    params: { percent: 41, windowMin: 15 },
  },
];

/* --------------------------------------------------------------- findings */

export const failingFinding: Finding = {
  facts: failingObservations,
  hypotheses: [
    {
      id: "H1",
      titleFa: "متغیر محیطی SESSION_SECRET تعریف نشده است",
      explanationFa:
        "برنامه هنگام ساخت نشست به SESSION_SECRET نیاز دارد. این کلید سه دقیقه پیش از شروع خطاها حذف شده و از آن زمان صفحهٔ اصلی خطای ۵۰۰ می‌دهد.",
      supports: ["O1", "O2", "O4"],
      contradicts: [],
      level: "strong",
      levelReason: { rule: "signature_and_correlation", signature: true, correlation: true, contradicted: false },
      actionHint: "set_env",
    },
    {
      id: "H2",
      titleFa: "برنامه پشت سر هم کرش می‌کند",
      explanationFa: "خطای ۵۰۰ می‌تواند نشانهٔ کرش باشد، اما نمونهٔ برنامه در حال اجرا است و راه‌اندازی مجددی ثبت نشده است.",
      supports: ["O2"],
      contradicts: ["O5"],
      level: "insufficient",
      levelReason: { rule: "indirect", signature: false, correlation: false, contradicted: true },
    },
  ],
  ruledOut: [
    {
      titleFa: "کمبود حافظه",
      reasonFa: "نمونه بدون راه‌اندازی مجدد در حال اجراست و رویداد OOM ثبت نشده است.",
      observationIds: ["O5"],
    },
  ],
  unknowns: [
    {
      descriptionFa: "مقدار قبلی SESSION_SECRET در دسترس نیست.",
      howToGet: "اگر مقدار قبلی را دارید، هنگام تأیید آن را وارد کنید؛ وگرنه مقدار تصادفی ساخته می‌شود.",
    },
  ],
  limitsNote: ["لاگ‌ها فقط برای ۱۵ دقیقهٔ اخیر بررسی شدند."],
};

export const healthyFinding: Finding = {
  facts: healthyObservations,
  hypotheses: [],
  ruledOut: [
    {
      titleFa: "قطعی سایت",
      reasonFa: "بررسی HTTP پاسخ ۲۰۰ گرفت و آخرین نسخه آماده است.",
      observationIds: ["O1", "O2"],
    },
  ],
  unknowns: [],
};

/* -------------------------------------------------------------- proposals */

export const fixtureSetEnvParams: ActionParamsOf<"set_env"> = {
  type: "set_env",
  app: "broken-shop",
  changes: [{ op: "set", key: "SESSION_SECRET", valueSource: "generated", generator: "hex32" }],
};

export const fixtureResizeParams: ActionParamsOf<"resize"> = {
  type: "resize",
  resource: { kind: "app", name: "broken-shop" },
  planId: "standard-g2",
};

export const sampleDeployPlan: DeployPlan = {
  app: "blog-demo",
  network: "demo-net",
  steps: [
    { id: "S1", kind: "create_app", name: "blog-demo", platform: "node", planId: "standard-g2", network: "demo-net", cost: costFromHourly(1389) },
    {
      id: "S2",
      kind: "create_db",
      name: "blog-db",
      engine: "postgres",
      version: "16",
      planId: "db-small-g2",
      network: "demo-net",
      publicNetwork: false,
      cost: costFromHourly(694),
    },
    { id: "S3", kind: "wire_db", app: "blog-demo", db: "blog-db", mapping: { url: "DATABASE_URL" } },
    {
      id: "S4",
      kind: "set_env",
      app: "blog-demo",
      changes: [
        { op: "set", key: "SESSION_SECRET", valueSource: "generated", generator: "hex32" },
        { op: "set", key: "SMTP_PASSWORD", valueSource: "user" },
      ],
    },
    { id: "S5", kind: "deploy", app: "blog-demo", source: { kind: "upload", uploadId: "upl_demo_0001" }, port: 3000 },
    { id: "S6", kind: "domain_guidance", domain: "blog.example.ir" },
  ],
  totals: { perHourToman: 2083, perMonthToman: 1_499_760 },
};

export const fixtureDeployPlanParams: ActionParamsOf<"deploy_plan"> = { type: "deploy_plan", plan: sampleDeployPlan };

/** Pinned hashParams(...) of the params above; re-computed by the fixtures test. */
export const FIXTURE_HASHES = {
  setEnvParams: "1cbef433ba88ccf4b3ee4bb85ccacddd0fa62b1efc980652da11e3e2f5b3ff33",
  resizeParams: "b324ebe6107171dcb025a92eb9cfb978f2010ba30a5f3d2c06e55aa726522d0d",
  deployPlanParams: "ebfeb85cc79aa6fd39baa09f4921d2d92eeb59f026025f71989dc2f1d9a1c406",
  /** fingerprintState(FIXTURE_STATE) */
  state: "65c63885eee28e1cf0f2f6848517e432d711d20f1c9a13aee041efea3831bd31",
} as const;

export const FIXTURE_STATE = { app: "broken-shop", releaseId: "rel_demo_0002", envKeys: ["NODE_ENV", "PORT"] } as const;

const CREATED = "2026-10-22T08:00:00.000Z";
const EXPIRES = "2026-10-22T08:10:00.000Z";

export const proposedSetEnv: Proposal = {
  id: "p_demo_set_env_0001",
  status: "proposed",
  type: "set_env",
  target: { kind: "app", name: "broken-shop" },
  params: fixtureSetEnvParams,
  rationaleFa: "خطای «SESSION_SECRET is not defined» از زمان حذف این کلید تکرار می‌شود.",
  evidenceIds: ["O1", "O4"],
  effectFa: "کلید SESSION_SECRET با یک مقدار تصادفی ساخته‌شده روی سرور اضافه و برنامه دوباره راه‌اندازی می‌شود.",
  risksFa: ["نشست‌های فعلی کاربران باطل می‌شوند.", "برنامه چند ثانیه در دسترس نخواهد بود."],
  reversible: "partly",
  verificationPlan: ["برنامه در حال اجرا و نسخه «آماده»", `سه بررسی HTTP پیاپی با پاسخ ${statusCode("2xx")}`, "نبود خطای SESSION_SECRET در لاگ‌های پس از اجرا"],
  createdAt: CREATED,
  expiresAt: EXPIRES,
  updatedAt: CREATED,
  source: "agent",
  paramsHash: FIXTURE_HASHES.setEnvParams,
  idempotencyKey: "idk_2a1327cd7a673a6dd14b8d99b6eafb4788e9ae2e",
  stateFingerprint: FIXTURE_HASHES.state,
  history: [{ status: "proposed", at: CREATED }],
};

const LIFECYCLE: Record<ProposalStatus, ProposalStatus[]> = {
  proposed: [],
  approved: ["approved"],
  executing: ["approved", "executing"],
  verifying: ["approved", "executing", "verifying"],
  verified: ["approved", "executing", "verifying", "verified"],
  not_verified: ["approved", "executing", "verifying", "not_verified"],
  failed: ["approved", "executing", "failed"],
  rejected: ["rejected"],
  expired: ["expired"],
  stale: ["stale"],
};

function atMinute(minute: number): string {
  return new Date(Date.parse(CREATED) + minute * 60_000).toISOString();
}

/** One sample proposal per status, with a history consistent with the state machine. */
export const proposalFixtures: Record<ProposalStatus, Proposal> = Object.fromEntries(
  (Object.keys(LIFECYCLE) as ProposalStatus[]).map((status) => {
    const steps = LIFECYCLE[status];
    const minuteOf = (i: number) => (status === "expired" ? 10 : i + 1);
    const history = [{ status: "proposed" as const, at: CREATED }, ...steps.map((s, i) => ({ status: s, at: atMinute(minuteOf(i)) }))];
    const proposal: Proposal = {
      ...proposedSetEnv,
      id: `p_demo_${status}`,
      status,
      updatedAt: history[history.length - 1].at,
      history,
    };
    return [status, proposal];
  }),
) as Record<ProposalStatus, Proposal>;

export const proposedResize: Proposal = {
  ...proposedSetEnv,
  id: "p_demo_resize_0001",
  type: "resize",
  target: { kind: "app", name: "broken-shop" },
  params: fixtureResizeParams,
  rationaleFa: "مصرف حافظه در ۱۵ دقیقهٔ اخیر نزدیک سقف بوده و رویداد OOM ثبت شده است.",
  evidenceIds: ["O3"],
  effectFa: "پلن برنامه به standard-g2 تغییر می‌کند.",
  risksFa: ["هزینهٔ ماهانه افزایش می‌یابد.", "برنامه هنگام تغییر پلن دوباره راه‌اندازی می‌شود."],
  costEstimate: costFromHourly(1389),
  paramsHash: FIXTURE_HASHES.resizeParams,
};

export const proposedDeployPlan: Proposal = {
  ...proposedSetEnv,
  id: "p_demo_deploy_plan_0001",
  type: "deploy_plan",
  target: { kind: "app", name: "blog-demo" },
  params: fixtureDeployPlanParams,
  source: "setup",
  evidenceIds: [],
  rationaleFa: "پروژهٔ Node.js با پایگاه دادهٔ PostgreSQL شناسایی شد.",
  effectFa: "برنامه و پایگاه داده ساخته، به هم وصل و نسخهٔ اول منتشر می‌شود.",
  risksFa: ["ساخت برنامه و پایگاه داده هزینه دارد."],
  costEstimate: sampleDeployPlan.totals,
  paramsHash: FIXTURE_HASHES.deployPlanParams,
};

/* ------------------------------------------------- verification & incident */

export const sampleVerification: Verification = {
  checks: [
    { name: "app_running", passed: true, detail: "status RUNNING, release READY" },
    { name: "probe_2xx", passed: true, detail: "3/3 probes 200 (5 s apart)" },
    { name: "error_signature_absent", passed: true, detail: "no SESSION_SECRET errors in 42 log lines after 08:03:10" },
  ],
  outcome: "verified",
  before: { probeStatus: 500, errorCount15m: 37, appStatus: "RUNNING" },
  after: { probeStatus: 200, errorCount15m: 0, appStatus: "RUNNING" },
};

export const sampleNotVerified: Verification = {
  checks: [
    { name: "app_running", passed: true, detail: "status RUNNING, release READY" },
    { name: "probe_2xx", passed: false, detail: "2/3 probes returned 502" },
  ],
  outcome: "not_verified",
  before: { probeStatus: 500 },
  after: { probeStatus: 502 },
};

export const sampleIncident: Incident = {
  id: "inc_demo_0001",
  accountId: FIXTURE_ACCOUNT_ID,
  target: { kind: "app", name: "broken-shop" },
  startedAt: "2026-10-22T07:58:12.000Z",
  resolvedAt: "2026-10-22T08:04:00.000Z",
  finding: failingFinding,
  proposalId: "p_demo_verified",
  verification: sampleVerification,
  timeline: [
    { ts: "2026-10-22T07:58:12.000Z", kind: "detected", textFa: "اولین خطای SESSION_SECRET در لاگ‌ها" },
    { ts: "2026-10-22T08:00:00.000Z", kind: "proposed", refId: "p_demo_verified" },
    { ts: "2026-10-22T08:01:00.000Z", kind: "approved", refId: "p_demo_verified" },
    { ts: "2026-10-22T08:03:10.000Z", kind: "executed", refId: "p_demo_verified" },
    { ts: "2026-10-22T08:04:00.000Z", kind: "verified", refId: "p_demo_verified" },
  ],
  summaryMarkdown: `## خلاصه\n\nکلید SESSION_SECRET حذف شده بود؛ پس از افزودن آن، سه بررسی HTTP پاسخ ${statusCode(200)} گرفتند.`,
};

/* ----------------------------------------------------------------- stream */

export const sampleErrorEvent: { type: "data-error"; data: ErrorData } = {
  type: "data-error",
  data: { code: "liara.rate_limited", messageFa: "لیارا موقتاً درخواست‌ها را محدود کرده است.", retryAfterSec: 30 },
};

const verifiedProposal = proposalFixtures.verified;

/** A full investigate -> propose -> execute -> verify run, in emission order. */
export const sampleStreamEvents: CopilotStreamEvent[] = [
  { type: "data-step", id: "collect", data: { id: "collect", label: "جمع‌آوری شواهد", status: "running" } },
  ...failingObservations.map((o): CopilotDataStreamEvent => ({ type: "data-observation", id: o.id, data: o })),
  { type: "data-step", id: "collect", data: { id: "collect", label: "جمع‌آوری شواهد", status: "done" } },
  { type: "data-step", id: "analyze", data: { id: "analyze", label: "تحلیل", status: "running" } },
  { type: "text-delta", id: "t1", delta: "به احتمال زیاد کلید SESSION_SECRET حذف شده است." },
  { type: "data-finding", id: "finding", data: failingFinding },
  { type: "data-step", id: "analyze", data: { id: "analyze", label: "تحلیل", status: "done" } },
  { type: "data-proposal", id: verifiedProposal.id, data: proposalFixtures.proposed },
  { type: "data-execution", id: "exec-read", data: { proposalId: verifiedProposal.id, step: "read_envs", status: "done" } },
  { type: "data-execution", id: "exec-send", data: { proposalId: verifiedProposal.id, step: "send", status: "done" } },
  { type: "data-execution", id: "exec-readback", data: { proposalId: verifiedProposal.id, step: "readback", status: "done" } },
  { type: "data-verification", id: "verification", data: { proposalId: verifiedProposal.id, result: sampleVerification } },
  { type: "data-incident", id: sampleIncident.id, data: sampleIncident },
];
