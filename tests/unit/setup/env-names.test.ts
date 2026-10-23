import { describe, expect, it } from "vitest";
import { envNamesFromCode, envNamesFromReadme, parseSanitizedEnv, sanitizeEnvText, looksSecret } from "@/lib/setup/env-names";
import { bindsLocalhostOnly, portFromCommand, portFromDockerfile, portFromGo, portFromJsCode, portFromPython } from "@/lib/setup/ports";

describe("env name extraction", () => {
  const sample = [
    "# comment",
    "APP_KEY=base64:VERYSECRETKEYMATERIAL=",
    'export STRIPE_KEY="sk_live_abcdef"',
    "DB_CONNECTION=pgsql",
    "DATABASE_URL=mysql://user:hunter2@db.example.invalid/app",
    "# OPTIONAL_FLAG=1",
    "not a line",
    "lower=ignored?",
  ].join("\n");

  it("returns names and coarse engine hints, never values", () => {
    const out = sanitizeEnvText(sample);
    for (const leak of ["VERYSECRETKEYMATERIAL", "sk_live_abcdef", "hunter2", "db.example.invalid", "mysql://", "pgsql"]) expect(out).not.toContain(leak);
    const parsed = parseSanitizedEnv(out);
    expect(parsed.names).toEqual(expect.arrayContaining(["APP_KEY", "STRIPE_KEY", "DB_CONNECTION", "DATABASE_URL", "OPTIONAL_FLAG"]));
    expect(parsed.engineHints.sort()).toEqual(["mysql", "postgres"]);
  });

  it("finds names in code and README without values", () => {
    expect(envNamesFromCode("const a = process.env.API_TOKEN; os.environ['DB_PASS']; getenv('MAIL_HOST'); env('APP_URL')")).toEqual(
      expect.arrayContaining(["API_TOKEN", "DB_PASS", "MAIL_HOST", "APP_URL"]),
    );
    const readme = "## Environment variables\nSet `SESSION_SECRET` and `REDIS_URL`.\n```\nFOO_BAR=hunter2\n```\n";
    const names = envNamesFromReadme(readme);
    expect(names).toEqual(expect.arrayContaining(["SESSION_SECRET", "REDIS_URL", "FOO_BAR"]));
  });

  it("classifies secret-looking names", () => {
    for (const n of ["API_KEY", "DB_PASSWORD", "JWT_SECRET", "STRIPE_TOKEN", "DATABASE_URL", "PRIVATE_KEY"]) expect(looksSecret(n)).toBe(true);
    for (const n of ["APP_NAME", "LOG_LEVEL", "PORT"]) expect(looksSecret(n)).toBe(false);
  });
});

describe("port heuristics", () => {
  it("JS", () => {
    expect(portFromJsCode("const port = process.env.PORT || 4321;")).toBe(4321);
    expect(portFromJsCode("app.listen(8080, () => {})")).toBe(8080);
    expect(portFromJsCode("const PORT = 9000;\nserver.listen(PORT)")).toBe(9000);
    expect(portFromJsCode("nothing here")).toBeUndefined();
    expect(portFromJsCode("app.listen(99999)")).toBeUndefined();
  });
  it("commands, python, go, docker", () => {
    expect(portFromCommand("next start -p 3100")).toBe(3100);
    expect(portFromCommand("gunicorn app:app --bind 0.0.0.0:8000")).toBe(8000);
    expect(portFromCommand("python manage.py runserver 0.0.0.0:8001")).toBe(8001);
    expect(portFromPython("app.run(host='0.0.0.0', port=5050)")).toBe(5050);
    expect(portFromGo('http.ListenAndServe(":8089", nil)')).toBe(8089);
    expect(portFromDockerfile("FROM x\nEXPOSE 3000/tcp 4000")).toBe(3000);
  });
  it("loopback-only binds", () => {
    expect(bindsLocalhostOnly("app.listen(3000, '127.0.0.1')")).toBe(true);
    expect(bindsLocalhostOnly("app.run(host='localhost', port=1)")).toBe(true);
    expect(bindsLocalhostOnly("app.listen(3000, '0.0.0.0')")).toBe(false);
  });
});
