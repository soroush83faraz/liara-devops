import { envNamesFromCode } from "../env-names";
import { bindsLocalhostOnly, portFromCommand, portFromPython } from "../ports";
import { addDb, newFinding, safeVersion, type Dir, type Finding } from "./common";

const PY_DB: Array<[RegExp, Parameters<typeof addDb>[1], string]> = [
  [/^(psycopg2(-binary)?|psycopg|asyncpg|pg8000)$/, "postgres", "postgres driver"],
  [/^(mysqlclient|pymysql|mysql-connector-python|aiomysql)$/, "mysql", "mysql driver"],
  [/^(pymongo|motor|mongoengine|djongo|beanie)$/, "mongodb", "mongodb driver"],
  [/^(redis|django-redis|aioredis|rq)$/, "redis", "redis client"],
  [/^(pymssql|pyodbc|mssql-django)$/, "mssql", "sql server driver"],
  [/^elasticsearch(-dsl)?$/, "elasticsearch", "elasticsearch client"],
  [/^pika$/, "rabbitmq", "rabbitmq client"],
  [/^clickhouse-(driver|connect)$/, "clickhouse", "clickhouse client"],
];

const HEAVY_PY: Array<[RegExp, string]> = [
  [/^(numpy|pandas|scipy|scikit-learn|sklearn)$/, "ml_libs"],
  [/^(torch|tensorflow|transformers|opencv-python(-headless)?)$/, "ml_libs"],
  [/^(pillow|wand)$/, "image_processing"],
  [/^(selenium|playwright)$/, "headless_browser"],
  [/^(sqlalchemy|django|peewee|tortoise-orm)$/, "orm"],
];

/** Package names from requirements.txt / Pipfile / pyproject (names only; versions and URLs are dropped). */
export function pythonDependencyNames(d: Dir): Set<string> {
  const names = new Set<string>();
  const add = (raw: string) => {
    const n = /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(raw.trim())?.[0];
    if (n) names.add(n.toLowerCase().replace(/_/g, "-"));
  };
  for (const file of ["requirements.txt", "requirements/base.txt", "requirements/prod.txt", "requirements/production.txt"]) {
    const text = d.read(file);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith("#") || l.startsWith("-") || l.includes("://")) continue;
      add(l);
    }
  }
  const pipfile = d.read("Pipfile");
  if (pipfile) {
    const sec = /\[packages\]([\s\S]*?)(?:\n\[|$)/.exec(pipfile);
    for (const line of (sec?.[1] ?? "").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
      if (m) add(m[1]);
    }
  }
  const pyproject = d.read("pyproject.toml");
  if (pyproject) {
    const deps = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(pyproject);
    for (const m of (deps?.[1] ?? "").matchAll(/["']([^"']+)["']/g)) add(m[1]);
    const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(pyproject);
    for (const line of (poetry?.[1] ?? "").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
      if (m && m[1].toLowerCase() !== "python") add(m[1]);
    }
  }
  return names;
}

function pythonVersion(d: Dir): string | undefined {
  const runtime = /python-?([\d.]+)/i.exec(d.read("runtime.txt") ?? "")?.[1];
  const dotv = d.read(".python-version")?.trim();
  const req = /requires-python\s*=\s*["']([^"']+)["']/.exec(d.read("pyproject.toml") ?? "")?.[1];
  const poetry = /^\s*python\s*=\s*["']([^"']+)["']/m.exec(d.read("pyproject.toml") ?? "")?.[1];
  return safeVersion(runtime ?? dotv ?? req ?? poetry);
}

export function detectPython(d: Dir): Finding | undefined {
  const hasManifest = d.has("requirements.txt") || d.has("Pipfile") || d.has("pyproject.toml") || d.has("setup.py");
  const hasManage = d.has("manage.py");
  if (!hasManifest && !hasManage) return undefined;
  const deps = pythonDependencyNames(d);
  const django = deps.has("django") || (hasManage && /django/i.test(d.read("manage.py") ?? ""));
  const flask = deps.has("flask");
  const f = django ? newFinding("django", hasManage ? 0.95 : 0.9) : flask ? newFinding("flask", 0.9) : newFinding("python", deps.size > 0 ? 0.6 : 0.45);

  const manifestFile = d.has("requirements.txt") ? "requirements.txt" : d.has("Pipfile") ? "Pipfile" : d.has("pyproject.toml") ? "pyproject.toml" : "manage.py";
  f.reasons.push({ code: "manifest_python", file: manifestFile });
  if (django) {
    f.framework = "Django";
    f.reasons.push({ code: hasManage ? "django_manage" : "dep_django", file: hasManage ? "manage.py" : manifestFile, detail: "django" });
  } else if (flask) {
    f.framework = "Flask";
    f.reasons.push({ code: "dep_flask", file: manifestFile, detail: "flask" });
  } else if (deps.has("fastapi")) {
    f.framework = "FastAPI";
    f.reasons.push({ code: "dep_fastapi", file: manifestFile, detail: "fastapi" });
  }
  f.pythonVersion = pythonVersion(d);
  if (!d.has("Pipfile.lock") && !d.has("poetry.lock") && !d.has("uv.lock") && !d.has("requirements.txt")) f.warnings.push("no_lockfile");
  if (d.has("poetry.lock")) f.packageManager = "poetry";
  else if (d.has("Pipfile")) f.packageManager = "pipenv";
  else if (d.has("uv.lock")) f.packageManager = "uv";
  else f.packageManager = "pip";

  const procfile = d.read("Procfile");
  const web = procfile ? /^web:\s*(.+)$/m.exec(procfile)?.[1]?.trim() : undefined;
  if (web) {
    f.startCommand = web.slice(0, 200);
    const p = portFromCommand(web);
    if (p) f.port = { value: p, source: "script" };
    if (bindsLocalhostOnly(web)) f.warnings.push("listens_localhost");
  } else if (!django && !flask) f.warnings.push("no_start_script");
  if (django && !f.startCommand) f.startCommand = "gunicorn";
  if (django && !deps.has("gunicorn") && !deps.has("uvicorn") && !deps.has("daphne") && !deps.has("hypercorn") && !deps.has("waitress")) f.warnings.push("python_no_wsgi_server");

  // Entry files (small, untrusted): port + env names + loopback binds.
  for (const file of ["app.py", "main.py", "run.py", "wsgi.py", "server.py", "application.py", "app/main.py", "src/main.py", "src/app.py"]) {
    const text = d.read(file);
    if (text === undefined) continue;
    if (!f.port) {
      const p = portFromPython(text);
      if (p) f.port = { value: p, source: "code" };
    }
    if (bindsLocalhostOnly(text)) f.warnings.push("listens_localhost");
    f.envNames.push(...envNamesFromCode(text));
  }

  for (const name of deps) {
    for (const [re, engine, label] of PY_DB) if (re.test(name)) addDb(f, engine, `${manifestFile}: ${name} (${label})`);
    for (const [re, hint] of HEAVY_PY) if (re.test(name) && !f.resourceHints.includes(hint)) f.resourceHints.push(hint);
  }

  // Django settings: DATABASES ENGINE + env names read via os.environ/env().
  const settings = d.under(3).filter((p) => /(^|\/)settings(\/[^/]+)?\.py$/.test(p));
  for (const rel of settings.slice(0, 4)) {
    const text = d.read(rel);
    if (!text) continue;
    f.envNames.push(...envNamesFromCode(text));
    const engine = /django\.db\.backends\.(postgresql|mysql|sqlite3|oracle)|django\.contrib\.gis\.db\.backends\.postgis|mssql|djongo/.exec(text);
    if (engine?.[1] === "postgresql" || /postgis/.test(engine?.[0] ?? "")) addDb(f, "postgres", `${rel}: DATABASES`);
    else if (engine?.[1] === "mysql") addDb(f, "mysql", `${rel}: DATABASES`);
    else if (engine?.[1] === "sqlite3") {
      f.warnings.push("sqlite_database");
      f.reasons.push({ code: "sqlite_file_db", file: rel });
    }
    if (!f.reasons.some((r) => r.code === "django_settings")) f.reasons.push({ code: "django_settings", file: rel });
  }
  return f;
}
