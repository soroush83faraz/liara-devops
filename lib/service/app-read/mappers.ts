// Liara client types -> safe DTOs. Only explicitly listed fields cross this boundary (no env values, no raw bodies).
import type { Applet, AppDetail, LogLine, Release } from "../../liara";
import { flagSuspiciousLines } from "../../security/injection";
import type { Redactor } from "../../security/redact";
import { detectLogLevel } from "./log-level";
import { isInProgressState, releaseDurationMs } from "./release-utils";
import { maskLines, maskSecrets } from "./safe-text";
import type { AppletDto, EventDto, GitInfoDto, LogLineDto, ReleaseDto } from "./types";

const clip = (v: string | null | undefined, max: number): string | undefined =>
  typeof v === "string" && v ? maskSecrets(v.length > max ? `${v.slice(0, max)}…` : v) : undefined;

function logLineDto(l: LogLine, message: string): LogLineDto {
  const flag = flagSuspiciousLines([message])[0];
  return {
    ts: l.ts,
    tsNs: l.tsNs,
    stream: l.stream,
    message,
    level: detectLogLevel(message),
    flagged: flag !== undefined,
    ...(flag ? { flagReason: flag.reasons[0] } : {}),
    ...(l.releaseId ? { releaseId: l.releaseId } : {}),
  };
}

/**
 * One log line for the browser. Pass the app's redactor (lib/service/app-read/known-secrets) so the app's own env
 * values are scrubbed too; prefer `toLogLineDtos` for a batch (it also catches secrets split over two lines).
 * (An options OBJECT, so `lines.map(toLogLineDto)` cannot silently pass the array index as the redactor.)
 */
export function toLogLineDto(l: LogLine, opts: { redactor?: Redactor } = {}): LogLineDto {
  return logLineDto(l, maskSecrets(l.message, opts.redactor));
}

/** A batch of log lines for the browser, masked together (1:1). */
export function toLogLineDtos(lines: readonly LogLine[], redactor?: Redactor): LogLineDto[] {
  const masked = maskLines(lines.map((l) => l.message), redactor);
  return lines.map((l, i) => logLineDto(l, masked[i]));
}

export function toEventDto(l: LogLine): EventDto {
  const message = maskSecrets(l.message);
  return { ts: l.ts, message, level: detectLogLevel(message) };
}

export function toAppletDto(a: Applet): AppletDto {
  return {
    ...(a.id ? { id: a.id } : {}),
    ...(a.name ? { name: a.name } : {}),
    ...(a.state ? { state: a.state } : {}),
    ...(a.reason ? { reason: maskSecrets(a.reason) } : {}),
    ...(a.timestamp ? { since: a.timestamp } : {}),
    ...(a.release?.releaseID ? { releaseId: a.release.releaseID } : {}),
    ...(a.release?.tag ? { releaseTag: a.release.tag } : {}),
  };
}

function toGitInfo(g: Release["gitInfo"]): GitInfoDto | undefined {
  if (!g) return undefined;
  const info: GitInfoDto = {
    ...(g.branch ? { branch: g.branch } : {}),
    ...(g.commit ? { commit: g.commit.slice(0, 40) } : {}),
    ...(g.message ? { message: clip(g.message, 300) } : {}),
    ...(g.committedAt ? { committedAt: g.committedAt } : {}),
    ...(g.author?.name ? { author: g.author.name } : {}),
    // Remote may embed credentials (https://user:token@host/...): masked.
    ...(g.remote ? { remote: clip(g.remote, 200) } : {}),
  };
  return Object.keys(info).length ? info : undefined;
}

export function toReleaseDto(r: Release, opts: { currentReleaseId?: string; now?: number } = {}): ReleaseDto {
  const id = r._id ?? "";
  const durationMs = releaseDurationMs(r.createdAt, r.finishedAt, opts.now);
  return {
    id,
    ...(r.tag ? { tag: r.tag } : {}),
    state: r.state ?? "UNKNOWN",
    ...(r.failReason ? { failReason: clip(r.failReason, 1000) } : {}),
    ...(r.queue ? { queue: r.queue } : {}),
    ...(r.port !== undefined ? { port: r.port } : {}),
    ...(r.type ? { type: r.type } : {}),
    ...(toGitInfo(r.gitInfo) ? { gitInfo: toGitInfo(r.gitInfo) } : {}),
    ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    isCurrent: Boolean(id) && id === opts.currentReleaseId,
    live: isInProgressState(r.state),
  };
}

export function toAppFacts(app: AppDetail, name: string) {
  return {
    name,
    ...(app.type ? { platform: app.type } : {}),
    ...(app.status ? { status: app.status } : {}),
    ...(app.scale !== undefined ? { scale: app.scale } : {}),
    ...(app.isDeployed !== undefined ? { isDeployed: app.isDeployed } : {}),
    ...(app.planID ? { planID: app.planID } : {}),
    ...(app.bundlePlanID ? { bundlePlanID: app.bundlePlanID } : {}),
    ...(app.hourlyPrice !== undefined ? { hourlyPrice: app.hourlyPrice } : {}),
    ...(app.created_at ? { createdAt: app.created_at } : {}),
    ...(app.network ? { network: { ...(app.network._id ? { id: app.network._id } : {}), ...(app.network.name ? { name: app.network.name } : {}) } } : {}),
    ...(app.defaultSubdomain === true ? { url: `https://${name}.liara.run` } : {}),
    ...(app.defaultSubdomain !== undefined ? { defaultSubdomain: app.defaultSubdomain } : {}),
    ...(app.zeroDowntime !== undefined ? { zeroDowntime: app.zeroDowntime } : {}),
    ...(app.readOnlyRootFilesystem !== undefined ? { readOnlyRootFilesystem: app.readOnlyRootFilesystem } : {}),
    ...(app.fixedIPStatus ? { fixedIPStatus: app.fixedIPStatus } : {}),
    ...(app.node?.IP ? { nodeIp: app.node.IP } : {}),
    ...(app.reservedDiskSpace !== undefined ? { reservedDiskSpace: app.reservedDiskSpace } : {}),
  };
}
