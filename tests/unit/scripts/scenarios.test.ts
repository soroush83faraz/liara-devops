import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSourceArchive } from "../../../lib/liara";
import { DEMO_ROOT, loadManifest, readLiaraJson, readScenarioSources, scenarioDir } from "../../../scripts/lib/scenarios";

const manifest = loadManifest();
const EXPECTED_IDS = ["healthy", "missing-secret", "wrong-port", "crash-loop", "cpu-bound", "memory-leak", "build-failure", "db-unreachable"];

describe("demo-app manifest", () => {
  it("lists exactly the stable scenario ids, once each", () => {
    expect(manifest.map((s) => s.id)).toEqual(EXPECTED_IDS);
  });

  it("has a directory for every id and no unlisted scenario directories", () => {
    const dirs = readdirSync(DEMO_ROOT).filter((n) => statSync(join(DEMO_ROOT, n)).isDirectory());
    expect(dirs.sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("describes symptom, cause and fix for every scenario", () => {
    for (const s of manifest) {
      expect(s.expectedSymptom.length).toBeGreaterThan(3);
      expect(s.acceptedReleaseStates.length).toBeGreaterThan(0);
    }
    const byId = Object.fromEntries(manifest.map((s) => [s.id, s]));
    expect(byId["missing-secret"].requiresEnv).toEqual(["SESSION_SECRET"]);
    expect(byId["missing-secret"].envSetup.unset).toEqual(["SESSION_SECRET"]);
    expect(byId["db-unreachable"].envSetup.set).toHaveProperty("DB_HOST");
    expect(byId["build-failure"].acceptedReleaseStates).toEqual(["FAILED"]);
  });
});

describe.each(EXPECTED_IDS)("scenario %s", (id) => {
  const dir = scenarioDir(id);

  it("has package.json, server.js and liara.json", () => {
    for (const f of ["package.json", "server.js", "liara.json"]) expect(existsSync(join(dir, f))).toBe(true);
  });

  it("is a dependency-free node app (build-failure has the one intentional bogus dependency)", () => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: unknown };
    expect(pkg.scripts?.start).toBe("node server.js");
    expect(pkg.devDependencies).toBeUndefined();
    if (id === "build-failure") expect(pkg.dependencies).toEqual({ express: "^99.0.0" });
    else expect(pkg.dependencies).toBeUndefined();
  });

  it("has a liara.json with platform node, a placeholder app name and port 3000", () => {
    expect(readLiaraJson(id)).toEqual({ platform: "node", app: "<placeholder>", port: 3000 });
  });

  it("serves its own version, matching the manifest", () => {
    const server = readFileSync(join(dir, "server.js"), "utf8");
    const version = manifest.find((s) => s.id === id)!.version;
    expect(server).toContain(`const SCENARIO = "${id}"`);
    expect(server).toContain(`const VERSION = "${version}"`);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version).toBe(version);
  });

  it("builds a source archive with the real createSourceArchive", async () => {
    const files = readScenarioSources(id, "broken-shop");
    expect(files.map((f) => f.path).sort()).toEqual(["liara.json", "package.json", "server.js"]);
    const lj = files.find((f) => f.path === "liara.json")!;
    expect(JSON.parse(String(lj.data)).app).toBe("broken-shop");
    const archive = await createSourceArchive({ files });
    expect(archive.size).toBeGreaterThan(100);
    expect(archive.size).toBeLessThan(64 * 1024);
    expect(archive.fileCount).toBeGreaterThanOrEqual(2); // liara.json is in the CLI's default ignores
    expect(archive.data.subarray(0, 2).toString("hex")).toBe("1f8b"); // gzip magic
  });
});
