import { z } from "zod";
import {
  AppNameSchema,
  CostSchema,
  DbEngineSchema,
  DbNameSchema,
  DbVersionSchema,
  DockerImageSchema,
  DomainNameSchema,
  NetworkNameSchema,
  PlanIdSchema,
  PlatformSchema,
  PortSchema,
  SafeIdSchema,
  HOURS_PER_MONTH,
  type Cost,
} from "./common";
import { EnvChangeListSchema, WireMappingSchema } from "./env";

/**
 * A setup-assistant plan, approved as one batch (action type `deploy_plan`).
 * Steps run in order; per-step costs must add up to `totals`.
 */

export const DeployPlanStepIdSchema = z.string().regex(/^S[1-9][0-9]?$/);

export const DeployPlanStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: DeployPlanStepIdSchema,
    kind: z.literal("create_app"),
    name: AppNameSchema,
    platform: PlatformSchema,
    planId: PlanIdSchema,
    bundlePlanId: PlanIdSchema.optional(),
    network: NetworkNameSchema.optional(),
    cost: CostSchema,
  }),
  z.strictObject({
    id: DeployPlanStepIdSchema,
    kind: z.literal("set_env"),
    app: AppNameSchema,
    changes: EnvChangeListSchema,
  }),
  z.strictObject({
    id: DeployPlanStepIdSchema,
    kind: z.literal("deploy"),
    app: AppNameSchema,
    source: z.discriminatedUnion("kind", [
      /** Server-side reference to an uploaded archive; never a client path. */
      z.strictObject({ kind: z.literal("upload"), uploadId: SafeIdSchema }),
      z.strictObject({ kind: z.literal("image"), image: DockerImageSchema }),
    ]),
    port: PortSchema,
  }),
  z.strictObject({
    id: DeployPlanStepIdSchema,
    kind: z.literal("create_db"),
    name: DbNameSchema,
    engine: DbEngineSchema,
    version: DbVersionSchema,
    planId: PlanIdSchema,
    bundlePlanId: PlanIdSchema.optional(),
    network: NetworkNameSchema.optional(),
    publicNetwork: z.boolean(),
    cost: CostSchema,
  }),
  z.strictObject({
    id: DeployPlanStepIdSchema,
    kind: z.literal("wire_db"),
    app: AppNameSchema,
    db: DbNameSchema,
    mapping: WireMappingSchema,
  }),
  z.strictObject({
    id: DeployPlanStepIdSchema,
    kind: z.literal("domain_guidance"),
    domain: DomainNameSchema.optional(),
  }),
]);
export type DeployPlanStep = z.infer<typeof DeployPlanStepSchema>;
export type DeployPlanStepKind = DeployPlanStep["kind"];

export const MAX_DEPLOY_PLAN_STEPS = 12;

export function sumStepCosts(steps: readonly DeployPlanStep[]): Cost {
  let perHourToman = 0;
  let perMonthToman = 0;
  for (const s of steps) {
    if (s.kind === "create_app" || s.kind === "create_db") {
      perHourToman += s.cost.perHourToman;
      perMonthToman += s.cost.perMonthToman;
    }
  }
  return { perHourToman, perMonthToman };
}

export const DeployPlanSchema = z
  .strictObject({
    app: AppNameSchema,
    network: NetworkNameSchema.optional(),
    steps: z.array(DeployPlanStepSchema).min(1).max(MAX_DEPLOY_PLAN_STEPS),
    totals: CostSchema,
  })
  .superRefine((plan, ctx) => {
    const ids = plan.steps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "duplicate step id", path: ["steps"] });
    }

    let appCreatedAt = -1;
    const dbCreatedAt = new Map<string, number>();
    plan.steps.forEach((s, i) => {
      const path = ["steps", i];
      switch (s.kind) {
        case "create_app":
          if (appCreatedAt !== -1) ctx.addIssue({ code: "custom", message: "app created twice", path });
          if (s.name !== plan.app) ctx.addIssue({ code: "custom", message: "create_app name must equal plan.app", path });
          appCreatedAt = i;
          break;
        case "create_db":
          if (dbCreatedAt.has(s.name)) ctx.addIssue({ code: "custom", message: "database created twice", path });
          dbCreatedAt.set(s.name, i);
          break;
        case "set_env":
        case "deploy":
        case "wire_db":
          // Every step mutates only the plan's own app.
          if (s.app !== plan.app) ctx.addIssue({ code: "custom", message: "step targets a different app", path });
          break;
        case "domain_guidance":
          break;
      }
      if ((s.kind === "create_app" || s.kind === "create_db") && plan.network !== undefined && s.network !== plan.network) {
        ctx.addIssue({ code: "custom", message: "resources must be created in plan.network", path });
      }
      if (s.kind === "wire_db") {
        const created = dbCreatedAt.get(s.db);
        if (created === undefined && plan.steps.some((o) => o.kind === "create_db" && o.name === s.db)) {
          ctx.addIssue({ code: "custom", message: "wire_db must come after create_db", path });
        }
      }
    });

    if (appCreatedAt !== -1) {
      plan.steps.forEach((s, i) => {
        if ((s.kind === "set_env" || s.kind === "deploy" || s.kind === "wire_db") && i < appCreatedAt) {
          ctx.addIssue({ code: "custom", message: "step must come after create_app", path: ["steps", i] });
        }
      });
    }

    const sum = sumStepCosts(plan.steps);
    if (
      Math.abs(sum.perHourToman - plan.totals.perHourToman) > 1 ||
      Math.abs(sum.perMonthToman - plan.totals.perMonthToman) > HOURS_PER_MONTH
    ) {
      ctx.addIssue({ code: "custom", message: "totals must equal the sum of step costs", path: ["totals"] });
    }
  });
export type DeployPlan = z.infer<typeof DeployPlanSchema>;
