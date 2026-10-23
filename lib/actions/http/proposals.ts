// Proposal routes: list/get (reads), approve/execute/reject (mutating: strict origin + rate limit first),
// events (SSE). accountId and team always come from the session, never from the request.
import { z } from "zod";
import { SAFE_ID_RE } from "@/lib/contracts/common";
import { UserEnvValuesSchema } from "@/lib/contracts/env";
import { ProposalStatusSchema } from "@/lib/contracts/proposal";
import { errorResponse } from "@/lib/server/liara";
import { findIncidentByProposal } from "../incidents";
import { MESSAGES } from "../messages";
import { approveProposal, executeProposal, listProposals, loadProposal, rejectProposal } from "../proposals";
import { viewProposal } from "../view";
import { badRequest, errorToResponse, guardMutation, json, parseLimit, readJsonBody, scopeOf, type HttpDeps, type RouteCtx } from "./common";
import { proposalEventStream, reserveStream } from "./sse";

const SMALL_BODY = 4 * 1024;
const EXECUTE_MAX_BYTES = 1024 * 1024;

export const ApproveBodySchema = z.strictObject({ typedName: z.string().max(512).optional() });
export const ExecuteBodySchema = z.strictObject({
  approvalToken: z.string().min(1).max(2048),
  userValues: UserEnvValuesSchema.optional(),
});
export const RejectBodySchema = z.strictObject({});

const notFound = () => errorResponse(404, "not_found", MESSAGES.notFound);
const validId = (id: string) => SAFE_ID_RE.test(id);

export async function handleListProposals(ctx: RouteCtx, deps: HttpDeps): Promise<Response> {
  const url = new URL(ctx.request.url);
  const statusRaw = url.searchParams.get("status");
  const status = statusRaw === null ? undefined : ProposalStatusSchema.safeParse(statusRaw);
  if (status && !status.success) return errorResponse(400, "bad_request", MESSAGES.badRequest, { field: "status" });
  try {
    const proposals = await listProposals(deps, ctx.session.accountId, { limit: parseLimit(ctx.request.url, 50, 100), status: status?.data });
    return json({ proposals: proposals.map(viewProposal) });
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function handleGetProposal(ctx: RouteCtx, id: string, deps: HttpDeps): Promise<Response> {
  if (!validId(id)) return notFound();
  try {
    const p = await loadProposal(deps, ctx.session.accountId, id);
    return p ? json({ proposal: viewProposal(p) }) : notFound();
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function handleApprove(ctx: RouteCtx, id: string, deps: HttpDeps): Promise<Response> {
  const guard = guardMutation(ctx, deps, "approve", 20);
  if (guard) return guard;
  if (!validId(id)) return notFound();
  const body = await readJsonBody(ctx.request, SMALL_BODY);
  if (!body.ok) return body.response;
  const parsed = ApproveBodySchema.safeParse(body.value ?? {});
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const r = await approveProposal(deps, { liara: ctx.liara, scope: scopeOf(ctx.session) }, id, parsed.data);
    return json({ approvalToken: r.approvalToken, expiresAt: r.expiresAt, proposal: viewProposal(r.proposal) });
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function handleExecute(ctx: RouteCtx, id: string, deps: HttpDeps): Promise<Response> {
  const guard = guardMutation(ctx, deps, "execute", 10);
  if (guard) return guard;
  if (!validId(id)) return notFound();
  const body = await readJsonBody(ctx.request, EXECUTE_MAX_BYTES);
  if (!body.ok) return body.response;
  const parsed = ExecuteBodySchema.safeParse(body.value);
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const started = await executeProposal(deps, { liara: ctx.liara, scope: scopeOf(ctx.session) }, id, parsed.data);
    // The job already runs detached from this request (client disconnects do not cancel it); after() only keeps
    // it tracked for graceful shutdown, so a scheduling failure must not turn a started execution into a 500.
    try {
      deps.schedule(() => started.job);
    } catch {
      // the job keeps running regardless
    }
    return json({ proposalId: started.proposalId, status: started.status }, 202);
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function handleReject(ctx: RouteCtx, id: string, deps: HttpDeps): Promise<Response> {
  const guard = guardMutation(ctx, deps, "reject", 30);
  if (guard) return guard;
  if (!validId(id)) return notFound();
  const body = await readJsonBody(ctx.request, SMALL_BODY);
  if (!body.ok) return body.response;
  const parsed = RejectBodySchema.safeParse(body.value ?? {});
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    const r = await rejectProposal(deps, { liara: ctx.liara, scope: scopeOf(ctx.session) }, id);
    return json({ proposal: viewProposal(r.proposal) });
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function handleEvents(ctx: RouteCtx, id: string, deps: HttpDeps, opts: { heartbeatMs?: number; maxDurationMs?: number } = {}): Promise<Response> {
  if (!validId(id)) return notFound();
  const accountId = ctx.session.accountId;
  let proposal;
  try {
    proposal = await loadProposal(deps, accountId, id);
  } catch (e) {
    return errorToResponse(e);
  }
  if (!proposal) return notFound();
  const release = reserveStream(accountId);
  if (!release) return errorResponse(429, "rate_limited", MESSAGES.rateLimited, { retryAfterSec: 5 });
  const lastId = Number(ctx.request.headers.get("last-event-id") ?? "");
  const storedVerification = (await findIncidentByProposal(deps.store, accountId, id))?.verification;
  return proposalEventStream({
    accountId,
    proposal,
    storedVerification,
    signal: ctx.request.signal,
    afterSeq: Number.isInteger(lastId) && lastId > 0 ? lastId : undefined,
    heartbeatMs: opts.heartbeatMs,
    maxDurationMs: opts.maxDurationMs,
    onClose: release,
  });
}
