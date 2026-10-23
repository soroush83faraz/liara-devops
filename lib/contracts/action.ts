import { z } from "zod";
import {
  AppNameSchema,
  DbEngineSchema,
  DbNameSchema,
  DbVersionSchema,
  DiskNameSchema,
  DomainNameSchema,
  NetworkNameSchema,
  PlanIdSchema,
  PlatformSchema,
  PortSchema,
  SafeIdSchema,
  type Target,
} from "./common";
import { DeployPlanSchema } from "./deploy-plan";
import { EnvChangeListSchema, EnvKeySchema, MAX_ENV_CHANGES, WireMappingSchema, userValueKeysOf } from "./env";

/* ------------------------------------------------------------ action types */

export const ACTION_TYPES = [
  "restart",
  "set_env",
  "unset_env",
  "scale",
  "update_port",
  "resize",
  "redeploy_previous",
  "wire_db",
  "deploy_plan",
  "create_app",
  "create_db",
  "create_network",
  "delete_app",
  "delete_db",
  "delete_domain",
  "delete_disk",
] as const;
export const ActionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/** 0 = read (never an ActionType), 1 = one confirm, 2 = typed name (+cost), 3 = human-only destructive. */
export type Tier = 0 | 1 | 2 | 3;
export const REVERSIBILITY = ["yes", "partly", "no"] as const;
export const ReversibilitySchema = z.enum(REVERSIBILITY);
export type Reversibility = z.infer<typeof ReversibilitySchema>;

export interface ActionPolicy {
  readonly tier: Tier;
  /** May the copilot propose it? Tier-3 deletes never are. */
  readonly aiProposable: boolean;
  /** Creates or changes something Liara bills for (cost line required). */
  readonly billed: boolean;
  readonly reversible: Reversibility;
  /** The user must type the resource name to confirm. */
  readonly requiresTypedName: boolean;
}

const policy = (p: ActionPolicy): ActionPolicy => Object.freeze(p);

/**
 * Single source of truth for risk tiers. Frozen (table and rows) so no module can
 * flip e.g. `delete_app.aiProposable` at runtime.
 */
export const ACTION_POLICY: Readonly<Record<ActionType, ActionPolicy>> = Object.freeze({
  restart: policy({ tier: 1, aiProposable: true, billed: false, reversible: "yes", requiresTypedName: false }),
  set_env: policy({ tier: 1, aiProposable: true, billed: false, reversible: "partly", requiresTypedName: false }),
  unset_env: policy({ tier: 1, aiProposable: true, billed: false, reversible: "partly", requiresTypedName: false }),
  scale: policy({ tier: 1, aiProposable: true, billed: false, reversible: "yes", requiresTypedName: false }),
  update_port: policy({ tier: 1, aiProposable: true, billed: false, reversible: "yes", requiresTypedName: false }),
  resize: policy({ tier: 2, aiProposable: true, billed: true, reversible: "partly", requiresTypedName: true }),
  redeploy_previous: policy({ tier: 2, aiProposable: true, billed: false, reversible: "partly", requiresTypedName: true }),
  wire_db: policy({ tier: 2, aiProposable: true, billed: false, reversible: "partly", requiresTypedName: true }),
  deploy_plan: policy({ tier: 2, aiProposable: true, billed: true, reversible: "partly", requiresTypedName: true }),
  create_app: policy({ tier: 2, aiProposable: false, billed: true, reversible: "partly", requiresTypedName: true }),
  create_db: policy({ tier: 2, aiProposable: false, billed: true, reversible: "partly", requiresTypedName: true }),
  create_network: policy({ tier: 2, aiProposable: false, billed: false, reversible: "no", requiresTypedName: true }),
  delete_app: policy({ tier: 3, aiProposable: false, billed: false, reversible: "no", requiresTypedName: true }),
  delete_db: policy({ tier: 3, aiProposable: false, billed: false, reversible: "no", requiresTypedName: true }),
  delete_domain: policy({ tier: 3, aiProposable: false, billed: false, reversible: "no", requiresTypedName: true }),
  delete_disk: policy({ tier: 3, aiProposable: false, billed: false, reversible: "no", requiresTypedName: true }),
});

/** Runtime guard for untrusted strings (e.g. model output). */
export function isActionType(value: unknown): value is ActionType {
  return typeof value === "string" && (ACTION_TYPES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------- typed params */

/** A resource that both apps and databases support (scale, resize). */
export const ResourceRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("app"), name: AppNameSchema }),
  z.strictObject({ kind: z.literal("db"), name: DbNameSchema }),
]);
export type ResourceRef = z.infer<typeof ResourceRefSchema>;

export const RestartParamsSchema = z.strictObject({ type: z.literal("restart"), app: AppNameSchema });
export const SetEnvParamsSchema = z.strictObject({
  type: z.literal("set_env"),
  app: AppNameSchema,
  changes: EnvChangeListSchema,
});
export const UnsetEnvParamsSchema = z.strictObject({
  type: z.literal("unset_env"),
  app: AppNameSchema,
  keys: z
    .array(EnvKeySchema)
    .min(1)
    .max(MAX_ENV_CHANGES)
    .refine((keys) => new Set(keys).size === keys.length, { message: "duplicate env key" }),
});
/** Liara scale is 0 (stop) or 1 (start). */
export const ScaleParamsSchema = z.strictObject({
  type: z.literal("scale"),
  resource: ResourceRefSchema,
  scale: z.union([z.literal(0), z.literal(1)]),
});
export const UpdatePortParamsSchema = z.strictObject({
  type: z.literal("update_port"),
  app: AppNameSchema,
  port: PortSchema,
});
export const ResizeParamsSchema = z.strictObject({
  type: z.literal("resize"),
  resource: ResourceRefSchema,
  planId: PlanIdSchema,
  bundlePlanId: PlanIdSchema.optional(),
});
export const RedeployPreviousParamsSchema = z.strictObject({
  type: z.literal("redeploy_previous"),
  app: AppNameSchema,
  releaseId: SafeIdSchema,
});
/** Wire flow: env keys only; host/port/user/password come from the DB detail server-side. */
export const WireDbParamsSchema = z.strictObject({
  type: z.literal("wire_db"),
  app: AppNameSchema,
  db: DbNameSchema,
  mapping: WireMappingSchema,
});
export const DeployPlanParamsSchema = z.strictObject({ type: z.literal("deploy_plan"), plan: DeployPlanSchema });
export const CreateAppParamsSchema = z.strictObject({
  type: z.literal("create_app"),
  name: AppNameSchema,
  platform: PlatformSchema,
  planId: PlanIdSchema,
  bundlePlanId: PlanIdSchema.optional(),
  network: NetworkNameSchema.optional(),
  readOnlyRootFilesystem: z.boolean().optional(),
});
export const CreateDbParamsSchema = z.strictObject({
  type: z.literal("create_db"),
  name: DbNameSchema,
  engine: DbEngineSchema,
  version: DbVersionSchema,
  planId: PlanIdSchema,
  bundlePlanId: PlanIdSchema.optional(),
  network: NetworkNameSchema.optional(),
  publicNetwork: z.boolean(),
});
export const CreateNetworkParamsSchema = z.strictObject({ type: z.literal("create_network"), name: NetworkNameSchema });
export const DeleteAppParamsSchema = z.strictObject({ type: z.literal("delete_app"), app: AppNameSchema });
export const DeleteDbParamsSchema = z.strictObject({ type: z.literal("delete_db"), db: DbNameSchema });
export const DeleteDomainParamsSchema = z.strictObject({ type: z.literal("delete_domain"), domain: DomainNameSchema });
export const DeleteDiskParamsSchema = z.strictObject({
  type: z.literal("delete_disk"),
  app: AppNameSchema,
  disk: DiskNameSchema,
});

export const ACTION_PARAMS_SCHEMAS = {
  restart: RestartParamsSchema,
  set_env: SetEnvParamsSchema,
  unset_env: UnsetEnvParamsSchema,
  scale: ScaleParamsSchema,
  update_port: UpdatePortParamsSchema,
  resize: ResizeParamsSchema,
  redeploy_previous: RedeployPreviousParamsSchema,
  wire_db: WireDbParamsSchema,
  deploy_plan: DeployPlanParamsSchema,
  create_app: CreateAppParamsSchema,
  create_db: CreateDbParamsSchema,
  create_network: CreateNetworkParamsSchema,
  delete_app: DeleteAppParamsSchema,
  delete_db: DeleteDbParamsSchema,
  delete_domain: DeleteDomainParamsSchema,
  delete_disk: DeleteDiskParamsSchema,
} as const satisfies Record<ActionType, z.ZodType<{ type: ActionType }>>;

export const ActionParamsSchema = z.discriminatedUnion("type", [
  RestartParamsSchema,
  SetEnvParamsSchema,
  UnsetEnvParamsSchema,
  ScaleParamsSchema,
  UpdatePortParamsSchema,
  ResizeParamsSchema,
  RedeployPreviousParamsSchema,
  WireDbParamsSchema,
  DeployPlanParamsSchema,
  CreateAppParamsSchema,
  CreateDbParamsSchema,
  CreateNetworkParamsSchema,
  DeleteAppParamsSchema,
  DeleteDbParamsSchema,
  DeleteDomainParamsSchema,
  DeleteDiskParamsSchema,
]);
export type ActionParams = z.infer<typeof ActionParamsSchema>;
export type ActionParamsOf<T extends ActionType> = Extract<ActionParams, { type: T }>;

/** Types the copilot may propose; derived from the policy table so they cannot drift. */
export const AI_PROPOSABLE_ACTION_TYPES: readonly ActionType[] = Object.freeze(
  ACTION_TYPES.filter((t) => ACTION_POLICY[t].aiProposable),
);

/**
 * Params schema for the model's `propose_action` tool. The union cannot even
 * express a create/delete, and the refine re-checks the policy table.
 */
export const AiProposableActionParamsSchema = z
  .discriminatedUnion("type", [
    RestartParamsSchema,
    SetEnvParamsSchema,
    UnsetEnvParamsSchema,
    ScaleParamsSchema,
    UpdatePortParamsSchema,
    ResizeParamsSchema,
    RedeployPreviousParamsSchema,
    WireDbParamsSchema,
    DeployPlanParamsSchema,
  ])
  .refine((p) => ACTION_POLICY[p.type].aiProposable, { message: "action not proposable by the assistant" });
export type AiProposableActionParams = z.infer<typeof AiProposableActionParamsSchema>;

/** The resource an action mutates; the confirmation name and token binding use it. */
export function actionTarget(params: ActionParams): Target {
  switch (params.type) {
    case "restart":
    case "set_env":
    case "unset_env":
    case "update_port":
    case "redeploy_previous":
    case "wire_db":
    case "delete_app":
      return { kind: "app", name: params.app };
    case "scale":
    case "resize":
      return params.resource.kind === "app"
        ? { kind: "app", name: params.resource.name }
        : { kind: "db", name: params.resource.name };
    case "deploy_plan":
      return { kind: "app", name: params.plan.app };
    case "create_app":
      return { kind: "app", name: params.name };
    case "create_db":
      return { kind: "db", name: params.name };
    case "create_network":
      return { kind: "network", name: params.name };
    case "delete_db":
      return { kind: "db", name: params.db };
    case "delete_domain":
      return { kind: "domain", name: params.domain };
    case "delete_disk":
      return { kind: "disk", name: params.disk };
    default: {
      const unreachable: never = params;
      throw new Error(`unknown action ${String((unreachable as { type?: unknown }).type)}`);
    }
  }
}

/** Env keys whose values the user must type in the approval dialog. */
export function userValueKeys(params: ActionParams): string[] {
  if (params.type === "set_env") return userValueKeysOf(params.changes);
  if (params.type === "deploy_plan") {
    return userValueKeysOf(params.plan.steps.flatMap((s) => (s.kind === "set_env" ? s.changes : [])));
  }
  return [];
}
