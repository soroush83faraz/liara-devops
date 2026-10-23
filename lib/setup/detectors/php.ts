import { addDb, newFinding, obj, safeVersion, type Dir, type Finding } from "./common";

export function detectPhp(d: Dir): Finding | undefined {
  const composer = d.json("composer.json");
  const phpFiles = d.list().filter((n) => n.endsWith(".php"));
  if (!composer && phpFiles.length === 0) return undefined;
  const req = { ...obj(composer?.require), ...obj(composer?.["require-dev"]) };
  const has = (n: string) => Object.prototype.hasOwnProperty.call(req, n);
  const laravel = has("laravel/framework");
  const f = laravel ? newFinding("laravel", d.has("artisan") ? 0.97 : 0.92) : newFinding("php", composer ? 0.7 : 0.5);

  if (composer) f.reasons.push({ code: "manifest_composer", file: "composer.json" });
  if (laravel) {
    f.framework = "Laravel";
    f.reasons.push({ code: d.has("artisan") ? "laravel_artisan" : "dep_laravel", file: d.has("artisan") ? "artisan" : "composer.json", detail: "laravel/framework" });
    f.buildCommand = "composer install --no-dev --optimize-autoloader";
    if (!d.has("composer.lock")) f.warnings.push("no_lockfile");
  } else if (has("symfony/framework-bundle") || has("symfony/symfony")) {
    f.framework = "Symfony";
    f.reasons.push({ code: "dep_symfony", file: "composer.json", detail: "symfony" });
  } else if (!composer) {
    f.reasons.push({ code: "php_files", file: phpFiles[0] });
  } else {
    f.reasons.push({ code: "plain_php", file: "composer.json" });
  }
  f.packageManager = composer ? "composer" : undefined;
  const phpReq = typeof req.php === "string" ? safeVersion(req.php) : undefined;
  if (phpReq) f.reasons.push({ code: "php_version", file: "composer.json", detail: phpReq });

  if (has("predis/predis") || has("ext-redis")) addDb(f, "redis", "composer.json: redis");
  if (has("mongodb/laravel-mongodb") || has("jenssegers/mongodb") || has("ext-mongodb")) addDb(f, "mongodb", "composer.json: mongodb");
  if (has("ext-pdo_pgsql") || has("ext-pgsql")) addDb(f, "postgres", "composer.json: pgsql");
  if (has("ext-pdo_mysql") || has("ext-mysqli")) addDb(f, "mysql", "composer.json: mysql");
  if (has("ext-pdo_sqlsrv") || has("ext-sqlsrv")) addDb(f, "mssql", "composer.json: sqlsrv");
  if (laravel || has("doctrine/orm") || has("illuminate/database")) f.resourceHints.push("orm");
  return f;
}
