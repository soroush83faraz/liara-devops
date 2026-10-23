import { z } from "zod";
import { DB_ENGINES, DockerImageSchema, DomainNameSchema, EnvKeySchema, PLATFORMS } from "@/lib/contracts";
import { ProjectAnalysisSchema } from "./types";

const optId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/).optional();

export const ChoicesSchema = z.strictObject({
  appName: z.string().min(1).max(63),
  platform: z.enum(PLATFORMS).optional(),
  networkId: z.string().min(1).max(64).optional(),
  planId: optId,
  bundlePlanId: optId,
  includeDb: z.boolean().optional(),
  dbEngine: z.enum(DB_ENGINES).optional(),
  dbPlanId: optId,
  dbName: z.string().max(63).optional(),
  dbEnvKeys: z.partialRecord(z.enum(["host", "port", "user", "password", "database", "url"]), EnvKeySchema).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  dockerImage: DockerImageSchema.optional(),
  domain: DomainNameSchema.optional(),
  envChoices: z.array(z.strictObject({ name: EnvKeySchema, valueSource: z.enum(["user", "generated"]) })).max(50),
});

export const PlanBodySchema = z.strictObject({
  sourceRef: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  analysis: ProjectAnalysisSchema.optional(),
  choices: ChoicesSchema,
});
export type PlanBody = z.infer<typeof PlanBodySchema>;
