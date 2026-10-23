// Liara detail -> safe DTOs. The parsed `DatabaseDetail` has no password by construction (stripped at parse time);
// only explicitly listed fields cross this boundary.
import type { Backup, DatabaseDetail, DatabaseSummary, NormalizedPlan } from "../../liara";
import { mapDbStatus } from "./status";
import type { BackupDto, DbOverviewDto } from "./types";

export function toOverviewDto(
  db: DatabaseDetail,
  opts: { hostname: string; summary?: DatabaseSummary; plan?: NormalizedPlan; networkName?: string },
): DbOverviewDto {
  const status = db.status ?? opts.summary?.status;
  const scale = db.scale ?? opts.summary?.scale;
  const net = db.network ?? undefined;
  const netName = net?.name ?? opts.networkName;
  const planID = db.planID ?? opts.summary?.planID;
  const p = opts.plan;
  return {
    hostname: opts.hostname,
    engine: (db.type ?? opts.summary?.type ?? "").toLowerCase(),
    ...(db.version ? { version: db.version } : {}),
    ...(planID ? { planID } : {}),
    ...((db.bundlePlanID ?? opts.summary?.bundlePlanID) ? { bundlePlanID: db.bundlePlanID ?? opts.summary?.bundlePlanID } : {}),
    ...(status ? { status } : {}),
    uiStatus: mapDbStatus({ status, scale }),
    ...(scale !== undefined ? { scale } : {}),
    ...(db.volumeSize !== undefined ? { volumeSizeGb: db.volumeSize } : {}),
    ...(db.hourlyPrice !== undefined ? { hourlyPrice: db.hourlyPrice } : {}),
    ...((db.created_at ?? opts.summary?.created_at) ? { createdAt: db.created_at ?? opts.summary?.created_at } : {}),
    publicNetwork: db.publicNetwork ?? opts.summary?.publicNetwork ?? false,
    ...(db.internalPort !== undefined ? { internalPort: db.internalPort } : {}),
    network: net || netName ? { ...(net?._id ? { id: net._id } : {}), ...(netName ? { name: netName } : {}) } : null,
    ...(db.metaData?.standaloneReplicaSet !== undefined ? { standaloneReplicaSet: db.metaData.standaloneReplicaSet } : {}),
    ...(p ? { plan: { ramGb: p.ramGb, cpu: p.cpu, diskGb: p.diskGb, ...(p.priceKnown ? { pricePerMonth: p.pricePerMonth } : {}) } } : {}),
  };
}

/** Newest first. */
export function toBackupDtos(backups: readonly Backup[]): BackupDto[] {
  return backups
    .filter((b): b is Backup & { name: string } => typeof b.name === "string" && b.name.length > 0)
    .map((b) => ({
      name: b.name,
      ...(b.size !== undefined ? { size: b.size } : {}),
      ...(b.lastModified ? { lastModified: b.lastModified } : {}),
    }))
    .sort((a, b) => Date.parse(b.lastModified ?? "") - Date.parse(a.lastModified ?? "") || 0);
}
