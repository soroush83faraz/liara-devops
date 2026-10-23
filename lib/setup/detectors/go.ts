import { envNamesFromCode } from "../env-names";
import { bindsLocalhostOnly, portFromGo } from "../ports";
import { addDb, newFinding, safeVersion, type Dir, type Finding } from "./common";

const GO_DB: Array<[string, Parameters<typeof addDb>[1]]> = [
  ["github.com/lib/pq", "postgres"], ["github.com/jackc/pgx", "postgres"], ["gorm.io/driver/postgres", "postgres"],
  ["github.com/go-sql-driver/mysql", "mysql"], ["gorm.io/driver/mysql", "mysql"],
  ["go.mongodb.org/mongo-driver", "mongodb"],
  ["github.com/go-redis/redis", "redis"], ["github.com/redis/go-redis", "redis"],
  ["github.com/denisenkom/go-mssqldb", "mssql"], ["github.com/microsoft/go-mssqldb", "mssql"], ["gorm.io/driver/sqlserver", "mssql"],
  ["github.com/rabbitmq/amqp091-go", "rabbitmq"], ["github.com/streadway/amqp", "rabbitmq"],
];

const GO_FRAMEWORKS: Array<[string, string]> = [
  ["github.com/gin-gonic/gin", "Gin"], ["github.com/labstack/echo", "Echo"], ["github.com/gofiber/fiber", "Fiber"],
  ["github.com/go-chi/chi", "chi"], ["github.com/gorilla/mux", "gorilla/mux"],
];

export function detectGo(d: Dir): Finding | undefined {
  const mod = d.read("go.mod");
  if (mod === undefined) return undefined;
  const f = newFinding("go", 0.95);
  f.reasons.push({ code: "manifest_go_mod", file: "go.mod" });
  const ver = safeVersion(/^go\s+([\d.]+)/m.exec(mod)?.[1]);
  if (ver) f.reasons.push({ code: "go_version", file: "go.mod", detail: ver });
  const fw = GO_FRAMEWORKS.find(([m]) => mod.includes(m));
  if (fw) f.framework = fw[1];
  for (const [m, engine] of GO_DB) if (mod.includes(m)) addDb(f, engine, `go.mod: ${m.split("/").slice(-1)[0]}`);
  if (mod.includes("gorm.io/gorm")) f.resourceHints.push("orm");
  if (!d.has("go.sum")) f.warnings.push("no_lockfile");
  for (const file of ["main.go", "cmd/main.go", "cmd/server/main.go", "cmd/api/main.go", "server.go", "app.go"]) {
    const text = d.read(file);
    if (text === undefined) continue;
    if (!f.port) {
      const p = portFromGo(text);
      if (p) f.port = { value: p, source: "code" };
    }
    if (bindsLocalhostOnly(text) || /ListenAndServe\(\s*"(?:localhost|127\.0\.0\.1):/.test(text)) f.warnings.push("listens_localhost");
    f.envNames.push(...envNamesFromCode(text));
  }
  return f;
}
