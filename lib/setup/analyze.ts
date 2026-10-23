// Glue: archive bytes -> ProjectAnalysis, and the "no file" path (fixed questions, no guessing).
import { DB_ENGINES, PLATFORMS, DockerImageSchema, type DbEngine, type Platform } from "@/lib/contracts";
import { z } from "zod";
import { openArchive } from "./archive";
import { transformFile, wantsFile, analyzeProject } from "./detect";
import { ENV_NAME_RE, PLATFORM_ENV_NAMES, looksSecret } from "./env-names";
import { defaultPortFor } from "./sizing";
import type { ProjectAnalysis } from "./types";

export async function analyzeArchiveBytes(bytes: Uint8Array): Promise<ProjectAnalysis & { format: "zip" | "tgz" }> {
  const opened = await openArchive(bytes, { wants: wantsFile, transform: transformFile });
  return { ...analyzeProject(opened), format: opened.format };
}

/** The fixed question list for the no-file path. The UI renders it; the server validates the answers. */
export const QUESTIONS = [
  { id: "platform", kind: "select", options: [...PLATFORMS], required: true },
  { id: "database", kind: "select", options: ["none", ...DB_ENGINES], required: false },
  { id: "port", kind: "number", required: false },
  { id: "dockerImage", kind: "text", required: false },
  { id: "envNames", kind: "text", required: false },
] as const;

export const AnswersSchema = z.strictObject({
  platform: z.enum(PLATFORMS),
  database: z.enum(["none", ...DB_ENGINES] as const).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  dockerImage: DockerImageSchema.optional(),
  envNames: z.array(z.string().regex(ENV_NAME_RE)).max(50).optional(),
});
export type Answers = z.infer<typeof AnswersSchema>;

export const DescribeBodySchema = z.strictObject({
  description: z.string().max(2000).optional(),
  answers: AnswersSchema.optional(),
  sourceRef: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
});

/** Builds an analysis purely from what the user said. Nothing is inferred from the free-text description. */
export function analysisFromAnswers(a: Answers): ProjectAnalysis {
  const platform: Platform = a.platform;
  const names = [...new Set(a.envNames ?? [])].filter((n) => !PLATFORM_ENV_NAMES.has(n));
  const db: DbEngine | undefined = a.database && a.database !== "none" ? a.database : undefined;
  return {
    platform,
    confidence: 1,
    reasons: [{ code: "user_answer" }],
    candidates: [{ platform, score: 1 }],
    port: a.port ?? undefined,
    portSource: a.port ? "user" : undefined,
    staticSite: platform === "static" || platform === "react" || platform === "vue" || platform === "angular",
    hasDockerfile: platform === "docker",
    requiresDatabase: db ? [{ engine: db, evidence: "user answer" }] : [],
    envVarNames: names,
    secretsLikely: names.filter(looksSecret),
    resourceHints: [],
    warnings: [],
    monorepoCandidates: [],
    stats: { fileCount: 0, totalBytes: 0 },
  };
}

export { defaultPortFor };
