import { z } from "zod";
import { DB_ENGINES, PLATFORMS, type DbEngine, type Platform } from "@/lib/contracts";

export type SetupPlatform = Platform | "unknown";

/** Why a decision was made. `code` maps to a Persian sentence in setupFlow.reasons; file/detail are data, not prose. */
export interface Reason {
  code: string;
  file?: string;
  detail?: string;
}

export interface DbNeed {
  engine: DbEngine;
  /** Short, content-free evidence such as "package.json: pg". */
  evidence: string;
}

export type PortSource = "liara_json" | "dockerfile" | "code" | "script" | "config" | "default" | "user";

export interface ProjectAnalysis {
  platform: SetupPlatform;
  /** 0..1, deterministic. */
  confidence: number;
  reasons: Reason[];
  candidates: Array<{ platform: Platform; score: number }>;
  framework?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  packageManager?: string;
  startCommand?: string;
  buildCommand?: string;
  port?: number;
  portSource?: PortSource;
  staticSite: boolean;
  hasDockerfile: boolean;
  requiresDatabase: DbNeed[];
  /** Names only. Values of any .env file are never read into the analysis. */
  envVarNames: string[];
  secretsLikely: string[];
  /** Sizing hints: orm, headless_browser, image_processing, ml_libs. */
  resourceHints: string[];
  /** Codes mapped by setupFlow.warnings. */
  warnings: string[];
  monorepoCandidates: string[];
  liaraJson?: { platform?: Platform; port?: number; app?: string; envNames: string[] };
  stats: { fileCount: number; totalBytes: number };
}

/** The detector's view of an archive: a path list plus the few small files the archive layer retained. */
export interface ProjectFiles {
  /** Posix paths relative to the project root (single top folder already stripped), ignored dirs excluded. */
  paths: readonly string[];
  /** Text of a retained file, or undefined. Env files are returned names-only (see sanitizeEnvText). */
  read(path: string): string | undefined;
  totalBytes: number;
  /** Counters for warnings (files that were too large to inspect). */
  skippedLarge?: number;
  truncated?: boolean;
}

const code = z.string().regex(/^[a-z0-9_]{1,60}$/);
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const platformSchema = z.enum([...PLATFORMS, "unknown"] as const);

/** Used to validate analyses that arrive from the client (description path); archive analyses are recomputed server-side. */
export const ProjectAnalysisSchema = z.strictObject({
  platform: platformSchema,
  confidence: z.number().min(0).max(1),
  reasons: z
    .array(z.strictObject({ code, file: z.string().max(200).optional(), detail: z.string().max(200).optional() }))
    .max(40),
  candidates: z.array(z.strictObject({ platform: z.enum(PLATFORMS), score: z.number().min(0).max(1) })).max(14),
  framework: z.string().max(60).optional(),
  nodeVersion: z.string().max(30).optional(),
  pythonVersion: z.string().max(30).optional(),
  packageManager: z.string().max(30).optional(),
  startCommand: z.string().max(200).optional(),
  buildCommand: z.string().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  portSource: z.enum(["liara_json", "dockerfile", "code", "script", "config", "default", "user"]).optional(),
  staticSite: z.boolean(),
  hasDockerfile: z.boolean(),
  requiresDatabase: z
    .array(z.strictObject({ engine: z.enum(DB_ENGINES), evidence: z.string().max(200) }))
    .max(9),
  envVarNames: z.array(envName).max(200),
  secretsLikely: z.array(envName).max(200),
  resourceHints: z.array(code).max(10),
  warnings: z.array(code).max(30),
  monorepoCandidates: z.array(z.string().max(200)).max(20),
  liaraJson: z
    .strictObject({
      platform: z.enum(PLATFORMS).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      app: z.string().max(80).optional(),
      envNames: z.array(envName).max(100),
    })
    .optional(),
  stats: z.strictObject({ fileCount: z.number().int().min(0), totalBytes: z.number().min(0) }),
});
