// Is DATA_DIR on a mounted (persistent) disk? On Liara's Next.js platform the app filesystem is writable but
// temporary: a writable DATA_DIR proves nothing about persistence. The only evidence available from inside the
// container is the mount table: a persistent disk is a mount point at or above DATA_DIR other than the root.
// Output is a fixed enum; paths and mount details never leave this module except through the startup log line.
import { promises as nodeFs } from "node:fs";
import path from "node:path";

export type PersistenceState = "mounted" | "not_mounted" | "unknown";

export interface MountEntry {
  mountPoint: string;
  fsType: string;
}

/** Container plumbing, never a user disk. */
const IGNORED_PREFIXES = ["/proc", "/sys", "/dev"];
const IGNORED_FILES = new Set(["/etc/resolv.conf", "/etc/hostname", "/etc/hosts"]);
/** Filesystems that do not survive a restart (or are the container's own layer). */
const EPHEMERAL_FS = new Set(["tmpfs", "ramfs", "overlay", "overlayfs", "aufs", "proc", "sysfs", "devtmpfs", "devpts", "mqueue", "cgroup", "cgroup2"]);

const within = (dir: string, mountPoint: string) =>
  mountPoint === "/" || dir === mountPoint || dir.startsWith(mountPoint.endsWith("/") ? mountPoint : `${mountPoint}/`);

/** mountinfo escapes space, tab, newline and backslash as \040 \011 \012 \134. */
const unescapeMount = (s: string) => s.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));

/** Parses /proc/self/mountinfo: field 5 is the mount point; the filesystem type follows the " - " separator. */
export function parseMountInfo(text: string): MountEntry[] {
  const out: MountEntry[] = [];
  for (const line of text.split("\n")) {
    const sep = line.indexOf(" - ");
    if (sep < 0) continue;
    const left = line.slice(0, sep).split(" ");
    const right = line.slice(sep + 3).split(" ");
    if (left.length < 5 || !left[4]) continue;
    out.push({ mountPoint: unescapeMount(left[4]), fsType: right[0] ?? "" });
  }
  return out;
}

const isIgnored = (mountPoint: string) =>
  IGNORED_FILES.has(mountPoint) || IGNORED_PREFIXES.some((p) => mountPoint === p || mountPoint.startsWith(`${p}/`));

/**
 * `mounted` when the deepest mount containing `dir` is a real (non-root, non-ephemeral) mount; `not_mounted` when
 * that is the root / overlay / tmpfs; `unknown` when there is no usable table.
 */
export function classifyPersistence(dir: string, mounts: readonly MountEntry[]): PersistenceState {
  if (mounts.length === 0 || !path.isAbsolute(dir)) return "unknown";
  const target = path.normalize(dir);
  let best: MountEntry | undefined;
  for (const m of mounts) {
    if (isIgnored(m.mountPoint) || !within(target, m.mountPoint)) continue;
    if (!best || m.mountPoint.length >= best.mountPoint.length) best = m;
  }
  if (!best) return "unknown"; // no root entry at all: the table is not a container's
  if (best.mountPoint === "/" || EPHEMERAL_FS.has(best.fsType)) return "not_mounted";
  return "mounted";
}

export interface PersistenceDeps {
  platform: string;
  readMountInfo(): Promise<string>;
  realpath(p: string): Promise<string>;
}

export const nodePersistenceDeps: PersistenceDeps = {
  platform: process.platform,
  readMountInfo: () => nodeFs.readFile("/proc/self/mountinfo", "utf8"),
  realpath: (p) => nodeFs.realpath(p),
};

export interface PersistenceReport {
  state: PersistenceState;
  /** Absolute, symlink-resolved DATA_DIR. For the startup log only: never put it in an HTTP response. */
  resolvedDir: string;
}

export async function resolveDataDirPath(dir: string, deps: Pick<PersistenceDeps, "realpath"> = nodePersistenceDeps): Promise<string> {
  const abs = path.resolve(dir);
  try {
    return await deps.realpath(abs);
  } catch {
    return abs; // not created yet: the lexical path is the best answer
  }
}

export async function detectDataDirPersistence(dir: string, deps: PersistenceDeps = nodePersistenceDeps): Promise<PersistenceReport> {
  const resolvedDir = await resolveDataDirPath(dir, deps);
  if (deps.platform !== "linux") return { state: "unknown", resolvedDir };
  try {
    return { state: classifyPersistence(resolvedDir, parseMountInfo(await deps.readMountInfo())), resolvedDir };
  } catch {
    return { state: "unknown", resolvedDir };
  }
}

/** The single startup line: cwd, resolved data dir, persistence verdict, node version. No env values, no secrets. */
export function startupLine(report: PersistenceReport, cwd: string = process.cwd(), nodeVersion: string = process.version): string {
  return `[startup] cwd=${cwd} dataDir=${report.resolvedDir} persistent=${report.state} node=${nodeVersion}`;
}

export const PERSISTENCE_WARNING =
  "DATA_DIR is not on a mounted disk: the container filesystem is temporary, so everything written there (audit log, sessions) is lost on every restart. Mount the Liara disk and point DATA_DIR at the mount path.";
