// Pure health payload builder. Booleans and fixed enums only: no secrets, no env names beyond these fields,
// no calls to Liara. 503 only when a required production setting is broken so Liara restarts a bad deploy.
import pkg from "../../package.json";
import type { EnvMap } from "./env-contract";
import type { PersistenceDeps, PersistenceState } from "./persistence";
import { nodePersistenceDeps } from "./persistence";
import { checkProductionConfig, logConfigIssues, nodeDataDirFs, type DataDirFs, type DataDirState } from "./startup-check";

export interface HealthBody {
  /** degraded = serving, but production data will not survive a restart (DATA_DIR is not on a mounted disk). */
  status: "ok" | "degraded" | "unavailable";
  version: string;
  uptimeSec: number;
  checks: { sessionKey: boolean; dataDir: DataDirState; dataDirPersistent: PersistenceState; llmConfigured: boolean };
}

export interface HealthResult {
  httpStatus: 200 | 503;
  body: HealthBody;
}

const has = (env: EnvMap, name: string) => (env[name] ?? "").trim() !== "";

export async function buildHealth(
  env: EnvMap,
  fs: DataDirFs = nodeDataDirFs,
  uptimeSec: number = process.uptime(),
  persistence: PersistenceDeps = nodePersistenceDeps,
): Promise<HealthResult> {
  const report = await checkProductionConfig(env, fs, persistence);
  logConfigIssues(report);
  const sessionKey = !report.issues.some((i) => i.level === "error" && i.name === "APP_SESSION_KEY");
  const llmConfigured = has(env, "LIARA_AI_BASE_URL") && has(env, "LIARA_AI_API_KEY") && has(env, "LLM_MODEL");
  // Missing persistence never takes the app down (503 restarts it for nothing): it is surfaced as "degraded".
  const degraded = report.production && report.dataDir === "writable" && report.dataDirPersistent === "not_mounted";
  return {
    httpStatus: report.ok ? 200 : 503,
    body: {
      status: !report.ok ? "unavailable" : degraded ? "degraded" : "ok",
      version: pkg.version,
      uptimeSec: Math.floor(uptimeSec),
      checks: { sessionKey, dataDir: report.dataDir, dataDirPersistent: report.dataDirPersistent, llmConfigured },
    },
  };
}
