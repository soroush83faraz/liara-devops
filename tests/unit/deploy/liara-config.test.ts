import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("liara.json", () => {
  const cfg = JSON.parse(read("liara.json")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("targets the next platform with a numeric port and an app name", () => {
    expect(cfg.platform).toBe("next");
    expect(typeof cfg.port).toBe("number");
    expect(Number.isInteger(cfg.port)).toBe(true);
    expect(typeof cfg.app).toBe("string");
    expect(cfg.app).toMatch(/^[a-z0-9-]+$/);
  });

  it("carries no env values", () => {
    expect(cfg.envs).toBeUndefined();
    expect(read("liara.json")).not.toMatch(/APP_SESSION_KEY|API_KEY|TOKEN|SECRET/i);
  });

  it("health-checks /api/health on the configured port", () => {
    const hc = cfg.healthCheck;
    expect(hc.command).toContain(`http://localhost:${cfg.port}/api/health`);
    expect(hc.command).toContain("--fail");
    for (const k of ["interval", "timeout", "retries", "startPeriod"]) expect(typeof hc[k]).toBe("number");
  });

  it("mounts a persistent disk named data at the default DATA_DIR", () => {
    expect(cfg.disks).toEqual([{ name: "data", mountTo: "data" }]);
  });
});

describe(".liaraignore", () => {
  const lines = read(".liaraignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  it("excludes env files, VCS, deps, build output, tests and runtime data", () => {
    for (const p of [".env", ".env.*", "node_modules", ".next", ".git", "tests", "demo-app", "scripts", "docs", "*.zip", "/data"]) {
      expect(lines).toContain(p);
    }
  });

  it("never re-includes an env file", () => {
    expect(lines.filter((l) => l.startsWith("!") && l.includes(".env"))).toEqual([]);
  });
});
