import type { DbEngine, Platform } from "@/lib/contracts";
import type { DbNeed, PortSource, ProjectFiles, Reason } from "../types";

/** What one stack-specific detector concluded about one project directory. */
export interface Finding {
  platform: Platform;
  score: number;
  reasons: Reason[];
  framework?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  packageManager?: string;
  startCommand?: string;
  buildCommand?: string;
  port?: { value: number; source: PortSource };
  staticSite?: boolean;
  db: DbNeed[];
  envNames: string[];
  resourceHints: string[];
  warnings: string[];
}

export const newFinding = (platform: Platform, score: number): Finding => ({
  platform,
  score,
  reasons: [],
  db: [],
  envNames: [],
  resourceHints: [],
  warnings: [],
});

/** Read-only view of the project rooted at `dir` ("" = archive root). */
export class Dir {
  constructor(
    private readonly files: ProjectFiles,
    readonly dir: string,
    private readonly pathSet: ReadonlySet<string>,
  ) {}
  path(rel: string): string {
    return this.dir ? `${this.dir}/${rel}` : rel;
  }
  has(rel: string): boolean {
    return this.pathSet.has(this.path(rel));
  }
  read(rel: string): string | undefined {
    return this.files.read(this.path(rel));
  }
  json(rel: string): Record<string, unknown> | undefined {
    const text = this.read(rel);
    if (text === undefined) return undefined;
    try {
      const v: unknown = JSON.parse(text);
      return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
  /** Files directly inside this dir (names only). */
  list(): string[] {
    const prefix = this.dir ? `${this.dir}/` : "";
    const out: string[] = [];
    for (const p of this.pathSet) if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) out.push(p.slice(prefix.length));
    return out;
  }
  /** All paths under this dir (relative), up to `maxDepth` segments. */
  under(maxDepth = 3): string[] {
    const prefix = this.dir ? `${this.dir}/` : "";
    const out: string[] = [];
    for (const p of this.pathSet) {
      if (!p.startsWith(prefix)) continue;
      const rel = p.slice(prefix.length);
      if (rel.split("/").length <= maxDepth) out.push(rel);
    }
    return out;
  }
}

export function addDb(f: { db: DbNeed[] }, engine: DbEngine, evidence: string): void {
  if (!f.db.some((d) => d.engine === engine)) f.db.push({ engine, evidence: evidence.slice(0, 120) });
}

export const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);
export const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** A runtime version is shown to the user, so keep only version-ish text. */
export function safeVersion(v: unknown): string | undefined {
  const s = str(v, 40);
  return s && /^[\dA-Za-z.^~<>=|* _-]+$/.test(s) ? s.trim() : undefined;
}
