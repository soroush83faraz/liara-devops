import { AnyBodySchema, BackupLinkSchema, BackupsResponseSchema, DisksResponseSchema, type Backup, type DisksResponse } from "./schemas";
import type { LiaraClient } from "./core";
import { LiaraError } from "./core";
import { getApp } from "./apps";
import { seg } from "./util";

/**
 * Disk routes take the project `_id`, NOT the name (verified live 2026-10-23: `GET /v1/projects/{name}/disks` answers 500,
 * by `_id` 200). Only create works by name. The `_id` comes from getApp and is cached per client for a few seconds so
 * one operation (list + resize, ...) reads the app once.
 */
const ID_TTL_MS = 10_000;
const idCache = new WeakMap<LiaraClient, Map<string, { id: Promise<string>; at: number }>>();

export function resolveProjectId(client: LiaraClient, app: string): Promise<string> {
  const cache = idCache.get(client) ?? new Map<string, { id: Promise<string>; at: number }>();
  idCache.set(client, cache);
  const hit = cache.get(app);
  if (hit && Date.now() - hit.at < ID_TTL_MS) return hit.id;
  const id = getApp(client, app).then((a) => {
    if (!a._id) throw new LiaraError({ status: 0, kind: "unknown", code: "project_id_missing", message: `Liara returned no _id for app ${app}; the disk routes need it` });
    return a._id;
  });
  cache.set(app, { id, at: Date.now() });
  id.catch(() => cache.delete(app)); // never cache a failure
  return id;
}

const byName = (app: string) => `/v1/projects/${seg(app)}/disks`;
const byId = async (client: LiaraClient, app: string) => `/v1/projects/${seg(await resolveProjectId(client, app))}/disks`;

/** [V, verified live 2026-10-23 by project `_id`] GET /v1/projects/{_id}/disks -> {disks, mounts}; `mounts: []` = no release mounts the disk. */
export async function listDisks(client: LiaraClient, app: string): Promise<DisksResponse> {
  return client.get(await byId(client, app), DisksResponseSchema);
}

/** [V+CLI] POST /v1/projects/{name}/disks {name, size} (size in GB, sent as a string per the spec). BILLED. By NAME (verified live 2026-10-23). */
export async function createDisk(client: LiaraClient, app: string, name: string, sizeGb: number | string): Promise<void> {
  await client.post(byName(app), AnyBodySchema, { json: { name, size: String(sizeGb) } });
}

/** [V] POST /v1/projects/{_id}/disks/{dname}/resize {size} (project `_id`, assumed like the list route [VAL]) */
export async function resizeDisk(client: LiaraClient, app: string, disk: string, sizeGb: number | string): Promise<void> {
  await client.post(`${await byId(client, app)}/${seg(disk)}/resize`, AnyBodySchema, { json: { size: String(sizeGb) } });
}

/** [V] DELETE /v1/projects/{_id}/disks/{name}. Destroys data. (by `_id` [VAL]) */
export async function deleteDisk(client: LiaraClient, app: string, disk: string): Promise<void> {
  await client.delete(`${await byId(client, app)}/${seg(disk)}`, AnyBodySchema);
}

/** [V] GET /v1/projects/{id}/disks/{name}/backups */
export async function listDiskBackups(client: LiaraClient, app: string, disk: string): Promise<Backup[]> {
  return (await client.get(`${await byId(client, app)}/${seg(disk)}/backups`, BackupsResponseSchema)).backups;
}

/** [V] POST /v1/projects/{id}/disks/{name}/backups */
export async function createDiskBackup(client: LiaraClient, app: string, disk: string): Promise<void> {
  await client.post(`${await byId(client, app)}/${seg(disk)}/backups`, AnyBodySchema);
}

/** [V] POST /v1/projects/{id}/disks/{dname}/backups/{bname}/download -> {link} (time-limited URL). */
export async function getDiskBackupLink(client: LiaraClient, app: string, disk: string, backup: string): Promise<string> {
  return (await client.post(`${await byId(client, app)}/${seg(disk)}/backups/${seg(backup)}/download`, BackupLinkSchema)).link;
}
