import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { SourceFile } from "../../lib/liara";
import { UsageError } from "./args";

export const DEMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../demo-app");

export const ManifestEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  expectedSymptom: z.string().min(1),
  expectedCause: z.string().min(1),
  fixAction: z.string().min(1),
  requiresEnv: z.array(z.string()),
  /** Semver-like version string the scenario serves on /version. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Release states that count as success for this scenario (a build-failure demo is supposed to end FAILED). */
  acceptedReleaseStates: z.array(z.string()).min(1),
  /** Env state the scenario needs before deploying: keys to remove, values to set. */
  envSetup: z.object({ unset: z.array(z.string()), set: z.record(z.string(), z.string()) }),
});
export type ScenarioEntry = z.infer<typeof ManifestEntrySchema>;

export function loadManifest(root: string = DEMO_ROOT): ScenarioEntry[] {
  return z.array(ManifestEntrySchema).parse(JSON.parse(readFileSync(join(root, "scenarios.json"), "utf8")));
}

export function getScenario(id: string, root: string = DEMO_ROOT): ScenarioEntry {
  const found = loadManifest(root).find((s) => s.id === id);
  if (!found) throw new UsageError(`unknown scenario "${id}" (known: ${loadManifest(root).map((s) => s.id).join(", ")})`);
  return found;
}

export const scenarioDir = (id: string, root: string = DEMO_ROOT): string => join(root, id);

export interface LiaraJson {
  platform: string;
  app: string;
  port: number;
}
export function readLiaraJson(id: string, root: string = DEMO_ROOT): LiaraJson {
  const raw: unknown = JSON.parse(readFileSync(join(scenarioDir(id, root), "liara.json"), "utf8"));
  return z.object({ platform: z.string(), app: z.string(), port: z.number().int().min(1).max(65535) }).parse(raw);
}

/** All files of a scenario directory (posix relative paths). `liara.json` gets the real app name. */
export function readScenarioSources(id: string, appName: string, root: string = DEMO_ROOT): SourceFile[] {
  const dir = scenarioDir(id, root);
  if (!existsSync(dir)) throw new UsageError(`scenario directory missing: demo-app/${id}`);
  const out: SourceFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules") continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const path = relative(dir, full).split(sep).join("/");
        let data: Uint8Array | string = readFileSync(full);
        if (path === "liara.json") data = JSON.stringify({ ...readLiaraJson(id, root), app: appName }, null, 2) + "\n";
        out.push({ path, data });
      }
    }
  };
  walk(dir);
  return out;
}
