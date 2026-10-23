// Liara -> DTO mappers for the config tabs. Pure. The env mapper is the only door through which env data
// leaves the server on the list route, and it drops every value.
import type { AppDetail, Disk, Domain, EnvVar, NormalizedPlan } from "@/lib/liara";
import type { DiskDto, DisksDto, DomainDto, MaskedEnvDto, PlanOption, SettingsDto } from "./dto";
import { extractDnsRecords } from "./domain-doctor";

export function toMaskedEnvList(envs: ReadonlyArray<Pick<EnvVar, "key" | "value" | "encrypted">>): MaskedEnvDto[] {
  const out: MaskedEnvDto[] = [];
  for (const e of envs) {
    if (!e.key) continue;
    const dto: MaskedEnvDto = { key: e.key, masked: true, encrypted: e.encrypted === true };
    if (typeof e.value === "string") dto.valueLength = e.value.length;
    out.push(dto);
  }
  return out;
}

export function toDomainDto(d: Domain): DomainDto {
  const dto: DomainDto = {
    id: d._id ?? "",
    name: d.name ?? "",
    records: extractDnsRecords(d as Record<string, unknown>),
  };
  if (d.punycodeName) dto.punycodeName = d.punycodeName;
  if (d.status) dto.status = d.status;
  if (d.certificatesStatus) dto.certificatesStatus = d.certificatesStatus;
  if (d.redirectTo) dto.redirectTo = d.redirectTo;
  if (d.redirectStatus) dto.redirectStatus = d.redirectStatus;
  if (d.created_at) dto.createdAt = d.created_at;
  return dto;
}

export function toDisksDto(
  res: { disks: ReadonlyArray<Disk>; mounts: ReadonlyArray<{ name?: string; mountedTo?: string }> },
  reservedDiskSpace?: number,
): DisksDto {
  const disks: DiskDto[] = res.disks
    .filter((d) => d.name)
    .map((d) => {
      const dto: DiskDto = { name: d.name as string };
      if (d._id) dto.id = d._id;
      if (typeof d.size === "number") dto.sizeGb = d.size;
      if (d.createdAt) dto.createdAt = d.createdAt;
      const mount = res.mounts.find((m) => m.name === d.name)?.mountedTo;
      if (mount) dto.mountedTo = mount;
      return dto;
    });
  return { disks, ...(typeof reservedDiskSpace === "number" ? { reservedDiskSpace } : {}) };
}

export function toPlanOptions(plans: ReadonlyArray<NormalizedPlan>): PlanOption[] {
  return plans.map((p) => ({
    id: p.id,
    ramGb: p.ramGb,
    cpu: p.cpu,
    priceKnown: p.priceKnown,
    ...(p.priceKnown ? { pricePerHour: p.pricePerHour, pricePerMonth: p.pricePerMonth } : {}),
    available: p.available,
  }));
}

export function toSettingsDto(
  app: AppDetail,
  name: string,
  extra: { port?: number; plans: SettingsDto["plans"] },
): SettingsDto {
  const dto: SettingsDto = { name, plans: extra.plans };
  if (app.status) dto.status = app.status;
  if (typeof app.scale === "number") dto.scale = app.scale;
  if (typeof app.isDeployed === "boolean") dto.isDeployed = app.isDeployed;
  if (app.planID) dto.planID = app.planID;
  if (app.bundlePlanID) dto.bundlePlanID = app.bundlePlanID;
  if (typeof app.hourlyPrice === "number") dto.hourlyPrice = app.hourlyPrice;
  const port = extra.port ?? portFromDetail(app);
  if (port !== undefined) dto.port = port;
  if (typeof app.defaultSubdomain === "boolean") dto.defaultSubdomain = app.defaultSubdomain;
  if (typeof app.zeroDowntime === "boolean") dto.zeroDowntime = app.zeroDowntime;
  if (typeof app.readOnlyRootFilesystem === "boolean") dto.readOnlyRootFilesystem = app.readOnlyRootFilesystem;
  if (app.fixedIPStatus) dto.fixedIPStatus = app.fixedIPStatus;
  if (app.node?.IP) dto.nodeIp = app.node.IP;
  if (typeof app.reservedDiskSpace === "number") dto.reservedDiskSpace = app.reservedDiskSpace;
  return dto;
}

function portFromDetail(app: AppDetail): number | undefined {
  const p = (app as Record<string, unknown>).port;
  return typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535 ? p : undefined;
}
