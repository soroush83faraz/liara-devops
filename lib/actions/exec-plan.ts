// deploy_plan: runs the approved steps in order through the other executors. Stops at the first failure and
// reports which step failed and what already exists. Never rolls back automatically (deleting something the
// user just paid for is a destructive decision that stays with the user).
import {
  MAX_SOURCE_SIZE,
  SourceArchiveError,
  createRelease,
  deploySource,
  getApp,
  listReleases,
  uploadSource,
  watchRelease,
} from "@/lib/liara";
import type { ActionParamsOf } from "@/lib/contracts/action";
import type { DeployPlanStep } from "@/lib/contracts/deploy-plan";
import { scanTarGz } from "@/lib/create/tar-scan";
import { getSource } from "@/lib/setup/source-store";
import { ActionError, toActionError } from "./errors";
import { execCreateApp, execCreateDb } from "./exec-create";
import { applyChangeList, execWireDb } from "./exec-env";
import type { Outcome } from "./exec-app";
import { mutateOnce } from "./mutate";
import { checkBalance } from "./plans";
import type { Run } from "./run";

type DeployStep = Extract<DeployPlanStep, { kind: "deploy" }>;

const DEFAULT_WATCH_TIMEOUT_MS = 15 * 60_000;

async function latestRelease(run: Run, app: string): Promise<Record<string, unknown>> {
  const latest = (await listReleases(run.liara, app, { page: 1, count: 1 })).releases[0];
  return { latestReleaseId: latest?._id ?? null, latestState: latest?.state ?? null };
}

async function startRelease(run: Run, s: DeployStep, type: string): Promise<string> {
  const src = s.source;
  if (src.kind === "image") {
    const r = await mutateOnce("deploy", () => createRelease(run.liara, s.app, { image: src.image, port: s.port, type: "docker" }), async () => ({
      confirmed: false,
      after: await latestRelease(run, s.app),
    }));
    return r.value as string;
  }
  const stored = await (run.opts.getSource ?? getSource)(run.ctx.accountId, src.uploadId);
  if (!stored) throw new ActionError("not_found", { details: { resource: "upload", id: src.uploadId } });
  const bytes = stored.bytes;
  if (bytes.byteLength > MAX_SOURCE_SIZE) throw new ActionError("invalid", { details: { reason: "archive_too_large" } });
  // The format is decided by magic bytes, never by the (user-chosen) file name.
  const zip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const tarGz = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!zip && !tarGz) throw new ActionError("invalid", { details: { reason: "archive_unknown_format" } });
  run.step(`${s.id}:upload`, "running", `bytes=${bytes.byteLength}`);
  try {
    // A tar.gz is forwarded unchanged, so it gets the deploy route's strict scan and bounds before anything is
    // uploaded (a zip is repacked and validated by createSourceArchive inside deploySource).
    if (tarGz) await scanTarGz(bytes);
    const r = await mutateOnce(
      "deploy",
      async () => {
        if (tarGz) {
          const sourceID = await uploadSource(run.liara, s.app, bytes, { signal: run.opts.signal });
          return createRelease(run.liara, s.app, { sourceID, port: s.port, type });
        }
        return (await deploySource(run.liara, s.app, { zip: bytes }, { port: s.port, type }, { signal: run.opts.signal })).releaseID;
      },
      async () => ({ confirmed: false, after: await latestRelease(run, s.app) }),
    );
    run.step(`${s.id}:upload`, "done");
    return r.value as string;
  } catch (e) {
    if (e instanceof SourceArchiveError) throw new ActionError("invalid", { details: { reason: `archive_${e.code}` } });
    throw e;
  }
}

async function deployStep(run: Run, s: DeployStep, platform: string | undefined): Promise<string> {
  const app = await getApp(run.liara, s.app);
  if (app.scale === 0) throw new ActionError("app_stopped", { details: { app: s.app } });
  const type = s.source.kind === "image" ? "docker" : (platform ?? app.type);
  if (!type) throw new ActionError("invalid", { details: { reason: "platform_unknown" } });
  const releaseId = await startRelease(run, s, type);

  const timing = run.opts.deploy ?? {};
  run.step(`${s.id}:watch`, "running", `release=${releaseId}`);
  // Only state changes are forwarded: build output may print env values.
  for await (const ev of watchRelease(run.liara, releaseId, {
    signal: run.opts.signal,
    timeoutMs: timing.watchTimeoutMs ?? DEFAULT_WATCH_TIMEOUT_MS,
    ...(timing.queueIntervalMs !== undefined ? { queueIntervalMs: timing.queueIntervalMs } : {}),
    ...(timing.logIntervalMs !== undefined ? { logIntervalMs: timing.logIntervalMs } : {}),
    buildLogs: s.source.kind === "upload",
  })) {
    if (ev.kind === "state") run.step(`${s.id}:watch`, "running", `state=${ev.state}`);
    if (ev.kind === "done") {
      if (ev.ok) {
        run.step(`${s.id}:watch`, "done", `state=${ev.state}`);
        return releaseId;
      }
      run.step(`${s.id}:watch`, "failed", `state=${ev.state}`);
      throw new ActionError("release_failed", { details: { releaseId, state: ev.state, reason: ev.reason ?? null } });
    }
  }
  run.assertNotAborted();
  throw new ActionError("release_failed", { details: { releaseId, state: "UNKNOWN" } });
}

export async function execDeployPlan(run: Run, p: ActionParamsOf<"deploy_plan">): Promise<Outcome> {
  const plan = p.plan;
  const completed: string[] = [];
  const created: { app: boolean; dbs: string[]; releaseId: string | null } = { app: false, dbs: [], releaseId: null };
  const platform = plan.steps.find((s) => s.kind === "create_app")?.platform;
  let guidance: { domain: string | null } | null = null;

  await checkBalance(run.liara, plan.totals.perHourToman);
  for (const s of plan.steps) {
    run.assertNotAborted();
    if (s.kind === "domain_guidance") {
      // Reported, never executed: DNS is changed by the user at their registrar.
      guidance = { domain: s.domain ?? null };
      run.step(s.id, "skipped", "domain_guidance");
      continue;
    }
    run.step(s.id, "running", s.kind);
    const prefix = `${s.id}:`;
    try {
      switch (s.kind) {
        case "create_app":
          await execCreateApp(run, { name: s.name, platform: s.platform, planId: s.planId, bundlePlanId: s.bundlePlanId, network: s.network }, prefix);
          created.app = true;
          break;
        case "set_env":
          await applyChangeList(run, s.app, s.changes, prefix);
          break;
        case "deploy":
          created.releaseId = await deployStep(run, s, platform);
          break;
        case "create_db":
          await execCreateDb(
            run,
            { name: s.name, engine: s.engine, version: s.version, planId: s.planId, bundlePlanId: s.bundlePlanId, network: s.network, publicNetwork: s.publicNetwork },
            prefix,
          );
          created.dbs.push(s.name);
          break;
        case "wire_db":
          await execWireDb(run, { type: "wire_db", app: s.app, db: s.db, mapping: s.mapping }, prefix);
          break;
      }
    } catch (e) {
      const inner = toActionError(e, run.knownSecrets(), s.id);
      run.step(s.id, "failed", inner.code);
      throw new ActionError("step_failed", {
        details: {
          failedStep: s.id,
          failedKind: s.kind,
          error: inner.code,
          ...(inner.details ? { errorDetails: inner.details } : {}),
          completed: [...completed],
          created: { app: created.app, dbs: [...created.dbs], releaseId: created.releaseId },
        },
        after: inner.after,
        knownSecrets: run.knownSecrets(),
      });
    }
    completed.push(s.id);
    run.step(s.id, "done");
  }
  return {
    summary: { app: plan.app, completed, created, guidance, totals: plan.totals },
  };
}
