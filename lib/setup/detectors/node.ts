import { envNamesFromCode } from "../env-names";
import { bindsLocalhostOnly, portFromCommand, portFromJsCode } from "../ports";
import { addDb, newFinding, obj, safeVersion, str, type Dir, type Finding } from "./common";

const SERVER_FRAMEWORKS: Array<[string, string]> = [
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["@hapi/hapi", "Hapi"],
  ["@nestjs/core", "NestJS"],
  ["restify", "Restify"],
  ["sails", "Sails"],
  ["@adonisjs/core", "AdonisJS"],
  ["hono", "Hono"],
  ["socket.io", "Socket.IO"],
  ["nuxt", "Nuxt"],
  ["@sveltejs/kit", "SvelteKit"],
  ["@remix-run/node", "Remix"],
  ["@remix-run/serve", "Remix"],
];

const DB_DEPS: Array<[string, Parameters<typeof addDb>[1]]> = [
  ["pg", "postgres"], ["pg-promise", "postgres"], ["postgres", "postgres"], ["@vercel/postgres", "postgres"],
  ["mysql", "mysql"], ["mysql2", "mysql"], ["mariadb", "mariadb"],
  ["mongoose", "mongodb"], ["mongodb", "mongodb"],
  ["redis", "redis"], ["ioredis", "redis"], ["bullmq", "redis"], ["bull", "redis"], ["connect-redis", "redis"],
  ["mssql", "mssql"], ["tedious", "mssql"],
  ["@elastic/elasticsearch", "elasticsearch"], ["amqplib", "rabbitmq"], ["@clickhouse/client", "clickhouse"],
];

const HEAVY: Array<[string, string]> = [
  ["puppeteer", "headless_browser"], ["playwright", "headless_browser"], ["puppeteer-core", "headless_browser"],
  ["sharp", "image_processing"], ["canvas", "image_processing"], ["jimp", "image_processing"],
  ["@tensorflow/tfjs-node", "ml_libs"], ["onnxruntime-node", "ml_libs"],
  ["prisma", "orm"], ["@prisma/client", "orm"], ["sequelize", "orm"], ["typeorm", "orm"], ["drizzle-orm", "orm"], ["mikro-orm", "orm"],
];

const DISK_DEPS = ["sqlite3", "better-sqlite3", "sqlite", "nedb", "lowdb", "multer", "level", "@seald-io/nedb"];
const DEV_ONLY_TOOLS = new Set(["nodemon", "ts-node", "ts-node-dev", "tsx", "vite", "next", "nuxt", "react-scripts", "webpack-dev-server", "concurrently", "babel-node"]);

const ENTRY_CANDIDATES = [
  "index.js", "server.js", "app.js", "main.js", "index.ts", "server.ts", "app.ts", "main.ts", "index.mjs", "server.mjs",
  "src/index.js", "src/server.js", "src/app.js", "src/main.js", "src/index.ts", "src/server.ts", "src/app.ts", "src/main.ts",
  "server/index.js", "server/index.ts", "backend/server.js", "backend/index.js",
];

function packageManagerOf(d: Dir, pkg: Record<string, unknown>): string | undefined {
  const declared = str(pkg.packageManager, 40);
  if (declared) return declared.split("@")[0];
  if (d.has("pnpm-lock.yaml")) return "pnpm";
  if (d.has("yarn.lock")) return "yarn";
  if (d.has("bun.lockb") || d.has("bun.lock")) return "bun";
  if (d.has("package-lock.json") || d.has("npm-shrinkwrap.json")) return "npm";
  return undefined;
}

function prismaEngine(d: Dir, f: Finding): void {
  const schema = d.read("prisma/schema.prisma");
  if (!schema) return;
  const m = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/.exec(schema);
  const p = m?.[1];
  if (p === "postgresql") addDb(f, "postgres", "prisma/schema.prisma: postgresql");
  else if (p === "mysql") addDb(f, "mysql", "prisma/schema.prisma: mysql");
  else if (p === "mongodb") addDb(f, "mongodb", "prisma/schema.prisma: mongodb");
  else if (p === "sqlserver") addDb(f, "mssql", "prisma/schema.prisma: sqlserver");
  else if (p === "sqlite") {
    f.warnings.push("sqlite_database");
    f.reasons.push({ code: "sqlite_file_db", file: "prisma/schema.prisma" });
  }
}

export function detectNode(d: Dir): Finding | undefined {
  const pkg = d.json("package.json");
  if (!pkg) return undefined;
  const deps = { ...obj(pkg.devDependencies), ...obj(pkg.dependencies) };
  const prodDeps = obj(pkg.dependencies);
  const scripts = obj(pkg.scripts);
  const has = (n: string) => Object.prototype.hasOwnProperty.call(deps, n);
  const hasProd = (n: string) => Object.prototype.hasOwnProperty.call(prodDeps, n);

  const server = SERVER_FRAMEWORKS.find(([n]) => has(n));
  const nextJs = has("next");
  const angular = has("@angular/core");
  const react = has("react") && (has("react-scripts") || has("vite") || has("react-dom"));
  const vue = has("vue");
  const f = server && !nextJs ? newFinding("node", 0.85) : nextJs ? newFinding("next", 0.95) : angular ? newFinding("angular", 0.95) : vue && !server ? newFinding("vue", 0.85) : react && !server ? newFinding("react", 0.85) : newFinding("node", scripts.start ? 0.6 : 0.4);

  f.reasons.push({ code: "manifest_package_json", file: "package.json" });
  if (nextJs) {
    f.framework = "Next.js";
    f.reasons.push({ code: "dep_next", file: "package.json", detail: "next" });
  } else if (angular) {
    f.framework = "Angular";
    f.staticSite = true;
    f.reasons.push({ code: "dep_angular", file: "package.json", detail: "@angular/core" });
    if (has("@angular/ssr") || has("@nguniversal/express-engine")) f.warnings.push("ssr_needs_node");
  } else if (server) {
    f.framework = server[1];
    f.reasons.push({ code: "dep_server_framework", file: "package.json", detail: server[0] });
    if (server[0] === "nuxt" || server[0] === "@sveltejs/kit") f.warnings.push("ssr_needs_node");
  } else if (vue) {
    f.framework = "Vue";
    f.staticSite = true;
    f.reasons.push({ code: "dep_vue", file: "package.json", detail: "vue" });
  } else if (react) {
    f.framework = has("react-scripts") ? "React (CRA)" : "React";
    f.staticSite = true;
    f.reasons.push({ code: "dep_react_spa", file: "package.json", detail: has("react-scripts") ? "react-scripts" : "react" });
  } else if (has("vite") || has("astro") || has("gatsby")) {
    f.staticSite = true;
    f.reasons.push({ code: "dep_static_generator", file: "package.json", detail: has("astro") ? "astro" : has("gatsby") ? "gatsby" : "vite" });
  } else {
    f.reasons.push({ code: scripts.start ? "script_start" : "plain_node", file: "package.json" });
  }
  if (server && react) f.reasons.push({ code: "fullstack_node", file: "package.json" });

  const pm = packageManagerOf(d, pkg);
  f.packageManager = pm;
  if (!pm) f.warnings.push("no_lockfile");

  const engines = obj(pkg.engines);
  f.nodeVersion = safeVersion(engines.node) ?? safeVersion(d.read(".nvmrc")?.trim().replace(/^v/, "")) ?? safeVersion(d.read(".node-version")?.trim().replace(/^v/, ""));

  const start = str(scripts.start);
  const build = str(scripts.build);
  if (!f.staticSite) f.startCommand = start;
  if (build) f.buildCommand = build;

  if (!f.staticSite) {
    if (!start && !str(pkg.main) && !d.has("server.js") && !d.has("index.js") && !nextJs) f.warnings.push("no_start_script");
    const tool = start?.trim().split(/\s+/)[0];
    if (tool && DEV_ONLY_TOOLS.has(tool) && !hasProd(tool) && has(tool) && !nextJs) f.warnings.push("start_uses_dev_dep");
  }

  // Port: explicit command flags first, then listen() in the usual entry files.
  const scriptPort = start ? portFromCommand(start) : undefined;
  if (scriptPort) f.port = { value: scriptPort, source: "script" };
  let localhostOnly = false;
  if (!f.staticSite) {
    let seen = 0;
    for (const candidate of ENTRY_CANDIDATES) {
      const text = d.read(candidate);
      if (text === undefined) continue;
      if (++seen > 8) break;
      if (!f.port) {
        const p = portFromJsCode(text);
        if (p) f.port = { value: p, source: "code" };
      }
      if (bindsLocalhostOnly(text)) localhostOnly = true;
      f.envNames.push(...envNamesFromCode(text));
    }
    if (localhostOnly) f.warnings.push("listens_localhost");
  }

  for (const [dep, engine] of DB_DEPS) if (has(dep)) addDb(f, engine, `package.json: ${dep}`);
  if (has("@prisma/client") || has("prisma")) prismaEngine(d, f);
  for (const [dep, hint] of HEAVY) if (has(dep) && !f.resourceHints.includes(hint)) f.resourceHints.push(hint);
  const diskDep = DISK_DEPS.find(has);
  if (diskDep) {
    f.warnings.push("writes_local_disk");
    f.reasons.push({ code: "dep_local_disk", file: "package.json", detail: diskDep });
  }
  if (pkg.workspaces !== undefined) f.warnings.push("workspaces");
  return f;
}
