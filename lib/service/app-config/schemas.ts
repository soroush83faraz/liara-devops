// Request-body schemas for the config routes (strict: unknown fields are rejected).
import { z } from "zod";
import { DiskNameSchema } from "@/lib/contracts/common";
import { APP_TOGGLES } from "./dto";

export const MAX_DISK_GB = 1000;

const TypedName = z.string().max(512).optional();
const DiskSize = z.number().int().min(1).max(MAX_DISK_GB);

export const RevealBody = z.strictObject({ key: z.string().min(1).max(256) });
export const AddDomainBody = z.strictObject({ name: z.string().min(1).max(300) });
export const SslBody = z.strictObject({ enable: z.boolean(), typedName: TypedName });
export const RedirectBody = z.strictObject({
  redirectTo: z.string().min(1).max(2048),
  redirectStatus: z.union([z.literal(301), z.literal(302)]),
});
export const CreateDiskBody = z.strictObject({ name: DiskNameSchema, sizeGb: DiskSize, typedName: TypedName });
export const ResizeDiskBody = z.strictObject({ sizeGb: DiskSize, typedName: TypedName });
export const ToggleBody = z.strictObject({
  toggle: z.enum(APP_TOGGLES),
  enabled: z.boolean(),
  typedName: TypedName,
});
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
