// Request-body schemas of the db mutation routes (strict: unknown keys are rejected).
import { z } from "zod";
import { readJsonCapped } from "@/lib/server/body";

/** Typed resource name typed by the user; compared with the target by `runUserOp`. */
const typedName = z.string().max(512);
export const PlanIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);

export const PublicNetworkBodySchema = z.strictObject({ enable: z.boolean(), typedName });
export const PowerBodySchema = z.strictObject({ scale: z.union([z.literal(0), z.literal(1)]), typedName });
export const ResizeBodySchema = z.strictObject({ planID: PlanIdSchema, disk: z.boolean().optional(), typedName });
export const ControlPanelBodySchema = z.strictObject({ enable: z.boolean(), typedName: typedName.optional() });
export const TypedNameBodySchema = z.strictObject({ typedName: typedName.optional() });

export const BACKUP_NAME_RE = /^[^\\/\u0000-\u001f\u007f]{1,200}$/;
export const isValidBackupName = (v: string): boolean => BACKUP_NAME_RE.test(v) && v !== "." && v !== "..";

export const MAX_BODY_BYTES = 4096;

/** Reads a small JSON body (streaming byte cap, never buffered past it); undefined on malformed/oversized/invalid input. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | undefined> {
  try {
    const body = await readJsonCapped(request, MAX_BODY_BYTES);
    if (!body.ok) return undefined;
    const parsed = schema.safeParse(body.empty ? {} : body.value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
