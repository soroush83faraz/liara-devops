import { after } from "next/server";
import { defaultHttpDeps } from "@/lib/actions/http/common";
import { handleExecute } from "@/lib/actions/http/proposals";
import { api } from "@/lib/server/liara";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/proposals/{id}/execute `{approvalToken, userValues?}` -> 202 `{proposalId, status:"executing"}`.
 * Execution + verification continue in the background (tracked with after()); progress on .../events.
 */
export const POST = api(async (ctx, { params }: Ctx) =>
  handleExecute(ctx, (await params).id, defaultHttpDeps((job) => after(job))),
);
