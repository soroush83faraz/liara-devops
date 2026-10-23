// POST /api/setup/plan { sourceRef?, analysis?, choices } -> builds the final DeployPlan, re-validating every choice
// against the account's real plans/networks (the client's copy is never trusted), persists a `deploy_plan` proposal
// (source 'setup') and returns { proposalId, plan, costs, explanation, userValueKeys, expiresAt }.
// Approval and execution are NOT here: the UI calls /api/proposals/[id]/approve and /execute (actions unit).
import { userValueKeys } from "@/lib/contracts";
import { computeTargetFingerprint } from "@/lib/actions/fingerprint";
import { fa } from "@/lib/i18n/fa";
import { listApps, listDatabases } from "@/lib/liara";
import { PolicyError, appendAudit, assertRateLimit, createProposal, getDefaultStore } from "@/lib/security";
import { api, errorResponse } from "@/lib/server/liara";
import { analyzeArchiveBytes } from "@/lib/setup/analyze";
import { ArchiveError } from "@/lib/setup/archive";
import { loadCatalog } from "@/lib/setup/catalog";
import { explainPlanParts } from "@/lib/setup/explain";
import { buildDeployPlan } from "@/lib/setup/plan";
import { PlanBodySchema } from "@/lib/setup/plan-request";
import { BodyTooLargeError, classifyContentType, readBodyCapped } from "@/lib/setup/request";
import { getSource } from "@/lib/setup/source-store";
import { errorText } from "@/lib/setup/text";

const S = fa.setupFlow;
const MAX_PLAN_BODY = 256 * 1024;

export const POST = api(async ({ request, session, liara }) => {
  try {
    assertRateLimit(`setup:plan:${session.accountId}`, 30, 10 * 60_000);
  } catch (e) {
    if (e instanceof PolicyError && e.code === "rate_limited") {
      return errorResponse(429, "rate_limited", S.errors.rate_limited, { retryAfterSec: Math.ceil((e.retryAfterMs ?? 1000) / 1000) });
    }
    throw e;
  }
  if (classifyContentType(request.headers.get("content-type")) !== "json") {
    return errorResponse(415, "unsupported_media_type", S.errors.unsupported_media_type);
  }

  let body;
  try {
    body = PlanBodySchema.safeParse(JSON.parse(new TextDecoder().decode(await readBodyCapped(request, MAX_PLAN_BODY))));
  } catch (e) {
    if (e instanceof BodyTooLargeError) return errorResponse(413, "payload_too_large", S.errors.payload_too_large);
    return errorResponse(400, "bad_request", S.errors.bad_request);
  }
  if (!body.success) return errorResponse(400, "bad_request", S.errors.bad_request);
  const { sourceRef, choices } = body.data;

  // The archive (when there is one) is re-analysed here: its analysis is the one we trust.
  let analysis = body.data.analysis;
  if (sourceRef) {
    const src = await getSource(session.accountId, sourceRef);
    if (!src) return errorResponse(410, "source_expired", S.errors.source_expired);
    try {
      const { format: _format, ...fresh } = await analyzeArchiveBytes(src.bytes);
      void _format;
      analysis = fresh;
    } catch (e) {
      if (e instanceof ArchiveError) return errorResponse(422, e.code, errorText(e.code));
      throw e;
    }
  }
  if (!analysis) return errorResponse(400, "bad_request", S.errors.bad_request);

  const catalog = await loadCatalog(liara);
  if (catalog.appPlans.length === 0) return errorResponse(409, "no_plans", S.errors.no_plans);
  // A chosen network cannot be validated against a list that failed to load: never report it as "unknown".
  if (choices.networkId && catalog.networksError) return errorResponse(502, "networks_unavailable", fa.errors.liaraUnavailable, { field: "networkId" });

  const [apps, dbs] = await Promise.all([listApps(liara), choices.includeDb ? listDatabases(liara) : Promise.resolve([])]);
  if (apps.some((a) => a.project_id === choices.appName)) return errorResponse(409, "app_exists", S.errors.app_exists, { field: "appName" });

  const built = buildDeployPlan(analysis, choices, { ...catalog, sourceRef });
  if (!built.ok) return errorResponse(400, built.code, errorText(built.code), { field: built.field });
  const dbStep = built.plan.steps.find((s) => s.kind === "create_db");
  if (dbStep && dbs.some((d) => d.hostname === dbStep.name)) return errorResponse(409, "db_exists", S.errors.db_exists, { field: "dbName" });

  const explanation = explainPlanParts(built.plan);
  const stateFingerprint = await computeTargetFingerprint(liara, { kind: "app", name: built.plan.app });
  const proposal = createProposal({
    accountId: session.accountId,
    params: { type: "deploy_plan", plan: built.plan },
    source: "setup",
    rationaleFa: S.proposal.rationale,
    evidenceIds: [],
    effectFa: explanation.summary,
    risksFa: [...S.proposal.risks],
    verificationPlan: [...S.proposal.verification],
    costEstimate: built.costs.totals,
    stateFingerprint,
  });
  const store = getDefaultStore();
  await store.proposals.put(session.accountId, proposal.id, proposal);
  try {
    await appendAudit(store, session.accountId, {
      actor: "user",
      action: "setup.plan",
      target: { kind: "app", name: built.plan.app },
      paramsHash: proposal.paramsHash,
      result: "ok",
      proposalId: proposal.id,
    });
  } catch {
    /* the audit trail is best-effort here; the real mutations are audited by the executor */
  }

  return Response.json(
    {
      proposalId: proposal.id,
      plan: built.plan,
      costs: built.costs,
      explanation,
      userValueKeys: userValueKeys(proposal.params),
      expiresAt: proposal.expiresAt,
      sourceRef,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
