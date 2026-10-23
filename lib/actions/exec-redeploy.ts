// redeploy_previous [VAL]: Liara has no rollback endpoint. An older READY release is redeployed from its
// built image, else from its stored source; when neither is available the action is refused, never faked.
import { createRelease, listReleases, type CreateReleaseInput, type Release } from "@/lib/liara";
import type { ActionParamsOf } from "@/lib/contracts/action";
import { ActionError } from "./errors";
import type { Outcome } from "./exec-app";
import { mutateOnce } from "./mutate";
import type { Run } from "./run";

const PAGE_SIZE = 20;
const MAX_PAGES = 5;
const READY = /^ready$/i;

interface Found {
  release: Release;
  current?: Release;
  currentId?: string;
}

/** The release must belong to this app: it is searched in the app's own release list, never fetched by id. */
async function findRelease(run: Run, app: string, releaseId: string): Promise<Found> {
  let currentId: string | undefined;
  let current: Release | undefined;
  let release: Release | undefined;
  for (let page = 1; page <= MAX_PAGES && !(release && current); page++) {
    const res = await listReleases(run.liara, app, { page, count: PAGE_SIZE });
    currentId ??= res.currentRelease;
    release ??= res.releases.find((r) => r._id === releaseId);
    current ??= res.releases.find((r) => currentId !== undefined && r._id === currentId);
    if (res.releases.length < PAGE_SIZE) break;
  }
  if (!release) throw new ActionError("not_found", { details: { resource: "release", id: releaseId } });
  return { release, current, currentId };
}

function sourceIdOf(release: Release): string | undefined {
  const raw = (release as Record<string, unknown>).sourceID;
  return typeof raw === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : undefined;
}

export async function execRedeployPrevious(run: Run, p: ActionParamsOf<"redeploy_previous">): Promise<Outcome> {
  run.step("find_release", "running");
  const { release, current, currentId } = await findRelease(run, p.app, p.releaseId);
  if (!READY.test(release.state ?? "")) {
    throw new ActionError("invalid", { details: { reason: "release_not_ready", state: release.state ?? null } });
  }
  if (currentId !== undefined && release._id === currentId) throw new ActionError("invalid", { details: { reason: "already_current" } });
  const port = release.port ?? current?.port;
  if (port === undefined) throw new ActionError("unsupported", { details: { reason: "port_unknown" } });

  let input: CreateReleaseInput;
  let method: "image" | "source";
  const sourceID = sourceIdOf(release);
  if (release.imageName) {
    input = { image: release.imageName, port, type: "docker" };
    method = "image";
  } else if (sourceID && release.sourceAvailable !== false) {
    input = { sourceID, port, type: release.type ?? release.projectType ?? "docker" };
    method = "source";
  } else {
    throw new ActionError("unsupported", { details: { reason: "no_image_or_source" } });
  }
  run.step("find_release", "done", `method=${method}`);

  run.step("create_release", "running");
  const r = await mutateOnce("create_release", () => createRelease(run.liara, p.app, input), async () => {
    // A new release in the list cannot be attributed to this call with certainty: never "confirmed".
    const latest = (await listReleases(run.liara, p.app, { page: 1, count: 1 })).releases[0];
    return { confirmed: false, after: { latestReleaseId: latest?._id ?? null, latestState: latest?.state ?? null } };
  });
  run.step("create_release", "done");
  return {
    summary: { app: p.app, fromReleaseId: p.releaseId, fromTag: release.tag ?? null, method, newReleaseId: r.value ?? null },
  };
}
