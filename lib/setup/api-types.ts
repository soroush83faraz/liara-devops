// Shapes of the setup API responses, shared by the routes and the browser client.
import type { Cost, DeployPlan } from "@/lib/contracts";
import type { CatalogView } from "./catalog";
import type { PlanExplanation } from "./explain";
import type { Recommendation } from "./recommend";
import type { ProjectAnalysis } from "./types";

export interface AnalyzeResponse {
  sourceRef?: string;
  fileName?: string;
  size?: number;
  format?: "zip" | "tgz";
  analysis: ProjectAnalysis;
  recommendation?: Recommendation;
  catalog?: CatalogView;
  /** catalog_unavailable: nothing could be read; networks_unavailable: plans are fine, the networks list is not. */
  catalogError?: "catalog_unavailable" | "networks_unavailable";
}

export interface QuestionsResponse {
  questions: ReadonlyArray<{ id: string; kind: string; options?: readonly string[]; required: boolean }>;
}

export interface PlanResponse {
  proposalId: string;
  plan: DeployPlan;
  costs: { app: Cost; db?: Cost; totals: Cost };
  explanation: PlanExplanation;
  /** Env keys whose values the user must supply when executing. */
  userValueKeys: string[];
  expiresAt: string;
  sourceRef?: string;
}
