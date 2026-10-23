// Which archive entries the detector wants to read. Everything else is only listed, never inflated.
import { sanitizeEnvText } from "./env-names";

const MANIFEST_NAMES = new Set([
  "package.json", "composer.json", "requirements.txt", "Pipfile", "pyproject.toml", "runtime.txt", ".python-version",
  "Procfile", "go.mod", "Dockerfile", "liara.json", ".nvmrc", ".node-version", "manage.py", "appsettings.json",
]);

const EXACT_PATHS = new Set([
  "requirements/base.txt", "requirements/prod.txt", "requirements/production.txt", "prisma/schema.prisma",
  // JS/TS entry files
  "index.js", "server.js", "app.js", "main.js", "index.ts", "server.ts", "app.ts", "main.ts", "index.mjs", "server.mjs",
  "src/index.js", "src/server.js", "src/app.js", "src/main.js", "src/index.ts", "src/server.ts", "src/app.ts", "src/main.ts",
  "server/index.js", "server/index.ts", "backend/server.js", "backend/index.js",
  // Python entry files
  "app.py", "main.py", "run.py", "wsgi.py", "server.py", "application.py", "app/main.py", "src/main.py", "src/app.py",
  // Go entry files
  "main.go", "cmd/main.go", "cmd/server/main.go", "cmd/api/main.go", "server.go", "app.go",
]);

const REAL_ENV_RE = /^\.env(\.(?!example$|sample$|template$|dist$|defaults?$)[\w.-]+)?$/;

export const isEnvFile = (base: string): boolean => base === ".env" || base.startsWith(".env.") || /^[\w-]+\.env$/.test(base) || base === "env.example";
/** A real env file (may hold real secrets), as opposed to .env.example and friends. */
export const isRealEnvFile = (path: string): boolean => REAL_ENV_RE.test(path.split("/").pop() ?? "");

export function wantsFile(path: string): boolean {
  const parts = path.split("/");
  const base = parts[parts.length - 1];
  const depth = parts.length;
  if (isEnvFile(base)) return depth <= 3;
  if (/^readme(\.md|\.txt)?$/i.test(base)) return depth <= 2;
  if (MANIFEST_NAMES.has(base)) return depth <= 3;
  if (/\.(cs|fs)proj$/.test(base)) return depth <= 3;
  if (/^next\.config\.(js|mjs|ts|cjs)$/.test(base)) return depth <= 2;
  if (/(^|\/)settings(\/[\w-]+)?\.py$/.test(path)) return depth <= 3;
  return EXACT_PATHS.has(path);
}

/** Applied by the archive reader the moment a file is inflated: env files never leave as raw text. */
export function transformFile(path: string, text: string): string {
  const base = path.split("/").pop() ?? "";
  return isEnvFile(base) ? sanitizeEnvText(text) : text;
}
