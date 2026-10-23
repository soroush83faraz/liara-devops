import { z } from "zod";
import { invalidArgument, isLiaraError, type LiaraClient } from "./core";
import {
  AnyBodySchema,
  AppDetailResponseSchema,
  AppletsResponseSchema,
  AppsResponseSchema,
  type Applet,
  type AppDetail,
  type AppSummary,
} from "./schemas";
import { parseAppEvents, parseLifecycleEvents, type AppEventsFeed, type AppLifecycleEvent } from "./events";
import type { LogLine } from "./logs";
import { isRecord, seg } from "./util";

/** [CLI] constants.ts AVAILABLE_PLATFORMS */
export const APP_PLATFORMS = [
  "node", "laravel", "php", "python", "django", "flask", "dotnet", "react", "angular", "vue", "static", "docker", "next", "go",
] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

const p = (name: string) => `/v1/projects/${seg(name)}`;

/** [V] GET /v1/projects */
export async function listApps(client: LiaraClient): Promise<AppSummary[]> {
  return (await client.get("/v1/projects", AppsResponseSchema)).projects;
}

/** [V] GET /v1/projects/{name}; `network` added per [CLI]. */
export async function getApp(client: LiaraClient, name: string): Promise<AppDetail> {
  return (await client.get(p(name), AppDetailResponseSchema)).project;
}

export interface CreateAppInput {
  name: string;
  planID: string;
  platform: AppPlatform;
  bundlePlanID: string;
  /** Network `_id` (not name). */
  network?: string;
  readOnlyRootFilesystem?: boolean;
}

/**
 * [V+CLI] POST /v1/projects. BILLED. The API answers with an empty 200, so the
 * app is re-fetched; returns null if the create succeeded but the refetch did not.
 * Error codes: 402/403 (free_plan_platform), 409 duplicate.
 */
export async function createApp(client: LiaraClient, input: CreateAppInput): Promise<AppDetail | null> {
  if (!(APP_PLATFORMS as readonly string[]).includes(input.platform)) throw invalidArgument(`Unknown platform: ${input.platform}`);
  if (input.planID === "free" && input.bundlePlanID !== "free") throw invalidArgument('Only the "free" bundle plan is available for the free plan');
  await client.post("/v1/projects", AnyBodySchema, {
    json: {
      name: input.name,
      planID: input.planID,
      platform: input.platform,
      bundlePlanID: input.bundlePlanID,
      network: input.network,
      readOnlyRootFilesystem: input.readOnlyRootFilesystem,
    },
  });
  try {
    return await getApp(client, input.name);
  } catch (e) {
    if (isLiaraError(e)) return null;
    throw e;
  }
}

/** [V] DELETE /v1/projects/{name}. Permanent. */
export async function deleteApp(client: LiaraClient, name: string): Promise<void> {
  await client.delete(p(name), AnyBodySchema);
}

/** [V] POST /v1/projects/{name}/actions/restart (async; 409 while another operation runs). */
export async function restartApp(client: LiaraClient, name: string): Promise<void> {
  await client.post(`${p(name)}/actions/restart`, AnyBodySchema);
}

/** [V] POST /v1/projects/{name}/actions/scale {scale: 0|1}: stop / start. */
export async function scaleApp(client: LiaraClient, name: string, scale: 0 | 1): Promise<void> {
  await client.post(`${p(name)}/actions/scale`, AnyBodySchema, { json: { scale } });
}
export const startApp = (client: LiaraClient, name: string) => scaleApp(client, name, 1);
export const stopApp = (client: LiaraClient, name: string) => scaleApp(client, name, 0);

/** [V] POST /v1/projects/{name}/resize {planID}. Cost/downtime unverified [VAL]. */
export async function resizeApp(client: LiaraClient, name: string, planID: string): Promise<void> {
  await client.post(`${p(name)}/resize`, AnyBodySchema, { json: { planID } });
}

/** [CLI] POST /v1/projects/update-port {project, port}. */
export async function updateAppPort(client: LiaraClient, name: string, port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidArgument("port must be 1-65535");
  await client.post("/v1/projects/update-port", AnyBodySchema, { json: { project: name, port } });
}

export type AppToggle = "zero-downtime" | "default-subdomain" | "fixed-ip" | "read-only";

/**
 * [V] POST /v1/projects/{id}/{toggle}/{enable|disable}. The spec calls the path
 * param `id`; whether the app name works is unverified [VAL] (the name is sent).
 * fixed-ip returns `{IP}`.
 */
export async function setAppToggle(client: LiaraClient, name: string, toggle: AppToggle, enabled: boolean): Promise<{ IP?: string }> {
  const res = await client.post(`${p(name)}/${toggle}/${enabled ? "enable" : "disable"}`, z.unknown());
  return isRecord(res) && typeof res.IP === "string" ? { IP: res.IP } : {};
}

/** [V] GET /v1/projects/{name}/applets: pods with state/reason/release. */
export async function listApplets(client: LiaraClient, name: string): Promise<Applet[]> {
  return (await client.get(`${p(name)}/applets`, AppletsResponseSchema)).applets;
}

export interface EventsQuery {
  search?: string;
  /** Unix seconds. */
  start?: number;
  end?: number;
  signal?: AbortSignal;
}

/** [V] GET /v1/projects/{name}/events with both views: structured lifecycle events and log-style lines. */
export async function getAppEventsFeed(client: LiaraClient, name: string, q: EventsQuery = {}): Promise<AppEventsFeed> {
  const raw = await client.get(`${p(name)}/events`, z.unknown(), {
    query: { search: q.search, start: q.start, end: q.end },
    signal: q.signal,
  });
  return parseAppEvents(raw);
}

/**
 * [V live 2026-10-23] GET /v1/projects/{name}/events as ascending log-style lines. Understands the live
 * `{data:[{id,status,action,time,release,tag}]}` lifecycle shape (rendered as `container <action> …`) and the older
 * Loki-style `{data:[{metaData,values}]}` shape (line text format unverified [VAL]).
 */
export async function getAppEvents(client: LiaraClient, name: string, q: EventsQuery = {}): Promise<LogLine[]> {
  return (await getAppEventsFeed(client, name, q)).lines;
}

/** [V live 2026-10-23] GET /v1/projects/{name}/events as ascending container lifecycle events. */
export async function listLifecycleEvents(client: LiaraClient, name: string, signal?: AbortSignal): Promise<AppLifecycleEvent[]> {
  return parseLifecycleEvents(await client.get(`${p(name)}/events`, z.unknown(), { signal }));
}
