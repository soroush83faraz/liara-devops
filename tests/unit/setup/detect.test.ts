import { describe, expect, it } from "vitest";
import { analyzeBytes, analyzeFixture, fixture, tarGzOf, zipOf } from "./helpers";

const reasonCodes = (a: { reasons: Array<{ code: string }> }) => a.reasons.map((r) => r.code);

describe("detector on synthetic project trees", () => {
  it("Next.js + Prisma/Postgres", async () => {
    const a = await analyzeFixture("nextjs");
    expect(a.platform).toBe("next");
    expect(a.framework).toBe("Next.js");
    expect(a.confidence).toBeGreaterThanOrEqual(0.9);
    expect(a.packageManager).toBe("npm");
    expect(a.nodeVersion).toBe(">=20");
    expect(a.port).toBe(3100);
    expect(a.portSource).toBe("script");
    expect(a.staticSite).toBe(false);
    expect(a.requiresDatabase.map((d) => d.engine)).toContain("postgres");
    expect(a.envVarNames).toEqual(expect.arrayContaining(["DATABASE_URL", "NEXTAUTH_SECRET", "STRIPE_SECRET_KEY", "SENTRY_DSN"]));
    expect(a.secretsLikely).toEqual(expect.arrayContaining(["NEXTAUTH_SECRET", "STRIPE_SECRET_KEY", "DATABASE_URL"]));
    expect(a.resourceHints).toContain("orm");
    expect(reasonCodes(a)).toContain("dep_next");
  });

  it("Express + MongoDB + Redis, port from code, env names from code and .env.example", async () => {
    const a = await analyzeFixture("express");
    expect(a.platform).toBe("node");
    expect(a.framework).toBe("Express");
    expect(a.port).toBe(4000);
    expect(a.portSource).toBe("code");
    expect(a.startCommand).toBe("node server.js");
    expect(a.requiresDatabase.map((d) => d.engine)).toEqual(["mongodb", "redis"]);
    expect(a.envVarNames).toEqual(expect.arrayContaining(["MONGO_URI", "JWT_SECRET"]));
    expect(a.warnings).not.toContain("no_lockfile");
  });

  it("flags a start script that needs dev dependencies, a loopback bind and a missing lockfile", async () => {
    const a = await analyzeFixture("express-localhost");
    expect(a.warnings).toEqual(expect.arrayContaining(["start_uses_dev_dep", "listens_localhost", "no_lockfile"]));
    expect(a.port).toBe(3000);
  });

  it("React SPA is a static build", async () => {
    const a = await analyzeFixture("react-spa");
    expect(a.platform).toBe("react");
    expect(a.staticSite).toBe(true);
    expect(a.startCommand).toBeUndefined();
    expect(a.buildCommand).toBe("vite build");
    expect(a.packageManager).toBe("yarn");
  });

  it("Django: manage.py, gunicorn port, settings DATABASES, python version", async () => {
    const a = await analyzeFixture("django");
    expect(a.platform).toBe("django");
    expect(a.port).toBe(8000);
    expect(a.pythonVersion).toBe("3.11.4");
    expect(a.requiresDatabase.map((d) => d.engine)).toEqual(["postgres"]);
    expect(a.envVarNames).toEqual(expect.arrayContaining(["DJANGO_SECRET_KEY", "DB_NAME"]));
  });

  it("Django with SQLite warns instead of asking for a database", async () => {
    const a = await analyzeFixture("sqlite-django");
    expect(a.platform).toBe("django");
    expect(a.requiresDatabase).toEqual([]);
    expect(a.warnings).toContain("sqlite_database");
  });

  it("Flask: app.run port and redis client", async () => {
    const a = await analyzeFixture("flask");
    expect(a.platform).toBe("flask");
    expect(a.port).toBe(5000);
    expect(a.requiresDatabase.map((d) => d.engine)).toEqual(["redis"]);
  });

  it("Laravel: artisan, MySQL from DB_CONNECTION, redis from composer", async () => {
    const a = await analyzeFixture("laravel");
    expect(a.platform).toBe("laravel");
    expect(a.requiresDatabase.map((d) => d.engine)).toEqual(["mysql", "redis"]);
    expect(a.envVarNames).toEqual(expect.arrayContaining(["APP_KEY", "DB_HOST", "DB_PASSWORD", "MAIL_PASSWORD"]));
    expect(a.secretsLikely).toEqual(expect.arrayContaining(["DB_PASSWORD", "MAIL_PASSWORD"]));
  });

  it("plain PHP", async () => {
    const a = await analyzeFixture("php-plain");
    expect(a.platform).toBe("php");
    expect(a.confidence).toBeLessThan(0.7);
  });

  it("Go with gin and lib/pq", async () => {
    const a = await analyzeFixture("go");
    expect(a.platform).toBe("go");
    expect(a.port).toBe(8080);
    expect(a.framework).toBe("Gin");
    expect(a.requiresDatabase.map((d) => d.engine)).toEqual(["postgres"]);
  });

  it(".NET web project with Npgsql", async () => {
    const a = await analyzeFixture("dotnet");
    expect(a.platform).toBe("dotnet");
    expect(a.framework).toBe("ASP.NET Core");
    expect(a.port).toBe(5050);
    expect(a.requiresDatabase.map((d) => d.engine)).toEqual(["postgres"]);
  });

  it("Dockerfile-only project uses the EXPOSE port", async () => {
    const a = await analyzeFixture("docker-only");
    expect(a.platform).toBe("docker");
    expect(a.hasDockerfile).toBe(true);
    expect(a.port).toBe(8081);
    expect(a.portSource).toBe("dockerfile");
  });

  it("Dockerfile wins over a framework, but the framework stays visible as a candidate", async () => {
    const a = await analyzeFixture("docker-nextjs");
    expect(a.platform).toBe("docker");
    expect(a.framework).toBe("Next.js");
    expect(a.candidates.map((c) => c.platform)).toContain("next");
    expect(a.warnings).toContain("dockerfile_and_framework");
  });

  it("liara.json overrides platform and port and contributes env names (never values)", async () => {
    const a = await analyzeFixture("liara-json");
    expect(a.platform).toBe("node");
    expect(a.port).toBe(5555);
    expect(a.portSource).toBe("liara_json");
    expect(a.liaraJson?.app).toBe("my-api");
    expect(a.envVarNames).toContain("API_TOKEN");
    expect(JSON.stringify(a)).not.toContain("FAKE_VALUE");
  });

  it("monorepo without a root manifest is ambiguous, not guessed", async () => {
    const a = await analyzeFixture("monorepo");
    expect(a.platform).toBe("unknown");
    expect(a.warnings).toContain("monorepo");
    expect(a.monorepoCandidates).toEqual(["apps/api", "apps/web", "packages/ui"]);
  });

  it("a single nested project is analysed but flagged as not at the archive root", async () => {
    const a = await analyzeFixture("nested-single");
    expect(a.platform).toBe("node");
    expect(a.warnings).toContain("not_at_root");
  });

  it("empty/unknown project", async () => {
    const a = await analyzeFixture("empty-unknown");
    expect(a.platform).toBe("unknown");
    expect(a.confidence).toBe(0);
    expect(a.warnings).toEqual(expect.arrayContaining(["unknown_platform", "no_dependency_manifest"]));
  });

  it("strips a single top-level folder (the way zip tools pack projects)", async () => {
    const a = await analyzeBytes(zipOf(fixture("express"), { prefix: "my-project/" }));
    expect(a.platform).toBe("node");
    expect(a.port).toBe(4000);
  });

  it("gives the same answer for tar.gz", async () => {
    const a = await analyzeBytes(tarGzOf(fixture("django")));
    expect(a.platform).toBe("django");
    expect(a.port).toBe(8000);
  });

  it("ignores node_modules content entirely", async () => {
    const tree = { ...fixture("express"), "node_modules/evil/package.json": JSON.stringify({ dependencies: { next: "1" } }) };
    const a = await analyzeBytes(zipOf(tree));
    expect(a.platform).toBe("node");
    expect(a.stats.fileCount).toBe(Object.keys(fixture("express")).length);
  });
});

describe("env names never carry values", () => {
  const SENTINELS = ["FAKE_PASSWORD_VALUE", "FAKE_SECRET_VALUE_123", "sk_test_FAKE_VALUE", "FAKE_DB_PASSWORD", "FAKE_MAIL_PASSWORD", "FAKE_ABCDEF_NOT_REAL", "postgresql://", "mongodb://", "FAKE_SECRET"];

  for (const name of ["nextjs", "laravel", "express", "with-real-env", "liara-json"]) {
    it(`${name}: analysis JSON contains no sentinel value`, async () => {
      const json = JSON.stringify(await analyzeFixture(name));
      for (const s of SENTINELS) expect(json).not.toContain(s);
    });
  }

  it("a real .env is reduced to names, flagged, and still gives an engine hint", async () => {
    const a = await analyzeFixture("with-real-env");
    expect(a.envVarNames).toEqual(expect.arrayContaining(["REAL_LOOKING_TOKEN", "DATABASE_URL"]));
    expect(a.warnings).toContain("env_file_in_archive");
    expect(a.requiresDatabase.map((d) => d.engine)).toContain("mysql");
  });
});
