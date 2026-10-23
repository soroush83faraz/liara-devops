import { AnyBodySchema, ReleaseResponseSchema, ReleasesResponseSchema, type Release, type ReleasesPage } from "./schemas";
import type { LiaraClient } from "./core";
import { seg } from "./util";

/** [V] GET /v1/projects/{name}/releases?page&count */
export function listReleases(client: LiaraClient, name: string, opts: { page?: number; count?: number } = {}): Promise<ReleasesPage> {
  return client.get(`/v1/projects/${seg(name)}/releases`, ReleasesResponseSchema, {
    query: { page: opts.page ?? 1, count: opts.count ?? 10 },
  });
}

/** [CLI] GET /v1/releases/{id}: `state`, `failReason`, `queue`. Not in the OpenAPI spec. */
export async function getRelease(client: LiaraClient, releaseId: string, signal?: AbortSignal): Promise<Release> {
  return (await client.get(`/v1/releases/${seg(releaseId)}`, ReleaseResponseSchema, { signal })).release;
}

/** [CLI] POST /v2/releases/{id}/cancel (the CLI retries this call; we do not, callers decide). */
export async function cancelRelease(client: LiaraClient, releaseId: string): Promise<void> {
  await client.post(`/v2/releases/${seg(releaseId)}/cancel`, AnyBodySchema);
}
