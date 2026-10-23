// Production configuration checks, run at first server use (health route) and callable from anywhere.
// Logs are English and contain variable names only, never values.
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { validateProductionEnv, type ConfigIssue, type EnvMap } from "./env-contract";
import { detectDataDirPersistence, nodePersistenceDeps, PERSISTENCE_WARNING, startupLine, type PersistenceDeps, type PersistenceReport, type PersistenceState } from "./persistence";

export type DataDirState = "writable" | "readonly" | "missing";

/** Minimal filesystem surface so the probe is testable without touching a disk. */
export interface DataDirFs {
  exists(dir: string): Promise<boolean>;
  mkdir(dir: string): Promise<void>;
  /** Writes and removes a probe file; rejects when the directory is not writable. */
  writeProbe(dir: string): Promise<void>;
}

export const nodeDataDirFs: DataDirFs = {
  async exists(dir) {
    try {
      return (await nodeFs.stat(dir)).isDirectory();
    } catch {
      return false;
    }
  },
  async mkdir(dir) {
    await nodeFs.mkdir(dir, { recursive: true });
  },
  async writeProbe(dir) {
    const file = path.join(dir, `.health-${process.pid}-${Date.now()}.tmp`);
    await nodeFs.writeFile(file, "ok", { flag: "wx" });
    await nodeFs.unlink(file);
  },
};

export function resolveDataDir(env: EnvMap): string {
  return (env.DATA_DIR ?? "").trim() || "./data";
}

const READONLY_CODES = new Set(["EACCES", "EPERM", "EROFS"]);

const PROBE_TIMEOUT_MS = 3000;

/** `missing` = absent and cannot be created; `readonly` = present (or creatable) but not writable. */
export async function probeDataDir(dir: string, fs: DataDirFs = nodeDataDirFs, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<DataDirState> {
  const run = async (): Promise<DataDirState> => {
    try {
      if (!(await fs.exists(dir))) await fs.mkdir(dir);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      return code && READONLY_CODES.has(code) ? "readonly" : "missing";
    }
    try {
      await fs.writeProbe(dir);
      return "writable";
    } catch {
      return "readonly";
    }
  };
  // A wedged filesystem (some mounts hang instead of failing) must not hang the health route.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DataDirState>((resolve) => {
    timer = setTimeout(() => resolve("missing"), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ProductionConfigReport {
  production: boolean;
  /** False only when a required production setting is wrong. Always true outside production. */
  ok: boolean;
  issues: ConfigIssue[];
  dataDir: DataDirState;
  /** Whether DATA_DIR sits on a mounted disk (the container filesystem is temporary on Liara). */
  dataDirPersistent: PersistenceState;
  /** Resolved absolute DATA_DIR: for the startup log only, never for an HTTP response. */
  resolvedDataDir: string;
}

export async function checkProductionConfig(
  env: EnvMap = process.env,
  fs: DataDirFs = nodeDataDirFs,
  persistence: PersistenceDeps = nodePersistenceDeps,
): Promise<ProductionConfigReport> {
  const production = env.NODE_ENV === "production";
  const validation = validateProductionEnv(env);
  const dir = resolveDataDir(env);
  const dataDir = await probeDataDir(dir, fs); // creates the directory when missing, so realpath below can resolve it
  const persist: PersistenceReport = await detectDataDirPersistence(dir, persistence);
  const issues = [...validation.issues];
  if (dataDir !== "writable") {
    issues.push({ level: "error", code: `data_dir_${dataDir}`, name: "DATA_DIR", message: `DATA_DIR is ${dataDir}; mount the Liara disk and point DATA_DIR at it.` });
  }
  // A warning, never an error: the app keeps serving, but the operator must know its data will not survive a restart.
  if (production && dataDir === "writable" && persist.state === "not_mounted") {
    issues.push({ level: "warn", code: "data_dir_not_persistent", name: "DATA_DIR", message: PERSISTENCE_WARNING });
  }
  // Outside production the session key falls back to a random per-process key and the store creates ./data.
  const ok = !production || !issues.some((i) => i.level === "error");
  return { production, ok, issues, dataDir, dataDirPersistent: persist.state, resolvedDataDir: persist.resolvedDir };
}

let logged = false;

/** Logs each issue once per process (English, no values). */
export function logConfigIssues(report: ProductionConfigReport): void {
  if (logged || !report.production) return;
  logged = true;
  for (const issue of report.issues) {
    const line = `[config] ${issue.level} ${issue.code} ${issue.name}: ${issue.message}`;
    if (issue.level === "error") console.error(line);
    else console.warn(line);
  }
}

let startupLogged = false;

/** Logs the one `[startup]` line per process: where the app runs and where its data really goes. No values, no secrets. */
export function logStartupLine(report: ProductionConfigReport): void {
  if (startupLogged) return;
  startupLogged = true;
  console.info(startupLine({ state: report.dataDirPersistent, resolvedDir: report.resolvedDataDir }));
}

/** Test seam: forget what was logged. */
export function resetStartupLogState(): void {
  startupLogged = false;
  logged = false;
}

/** Synchronous guard for code that must not run with a broken production setup. Throws with variable names only. */
export function assertProductionConfig(env: EnvMap = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const errors = validateProductionEnv(env).issues.filter((i) => i.level === "error");
  if (errors.length > 0) {
    throw new Error(`Invalid production configuration: ${errors.map((e) => `${e.name} (${e.code})`).join(", ")}`);
  }
}
