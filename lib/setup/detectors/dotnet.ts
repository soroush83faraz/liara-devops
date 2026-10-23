import { portFromDotnet } from "../ports";
import { addDb, newFinding, type Dir, type Finding } from "./common";

const NUGET_DB: Array<[RegExp, Parameters<typeof addDb>[1]]> = [
  [/Npgsql/i, "postgres"],
  [/MySql|Pomelo\.EntityFrameworkCore\.MySql|MySqlConnector/i, "mysql"],
  [/MongoDB\.Driver/i, "mongodb"],
  [/StackExchange\.Redis/i, "redis"],
  [/EntityFrameworkCore\.SqlServer|System\.Data\.SqlClient|Microsoft\.Data\.SqlClient/i, "mssql"],
  [/RabbitMQ\.Client/i, "rabbitmq"],
];

/** csproj/sln/Program.cs live at the root or one level down (src/App/App.csproj). */
export function detectDotnet(d: Dir): Finding | undefined {
  const projects = d.under(3).filter((p) => p.endsWith(".csproj") || p.endsWith(".fsproj"));
  const hasSln = d.list().some((n) => n.endsWith(".sln"));
  if (projects.length === 0 && !hasSln) return undefined;
  const f = newFinding("dotnet", projects.length > 0 ? 0.92 : 0.7);
  f.reasons.push({ code: "manifest_csproj", file: projects[0] ?? "*.sln" });
  const web = projects.filter((p) => /Microsoft\.NET\.Sdk\.Web/.test(d.read(p) ?? ""));
  if (web.length > 1) f.warnings.push("many_dotnet_projects");
  const main = web[0] ?? projects[0];
  const csproj = main ? d.read(main) : undefined;
  if (csproj) {
    if (/Microsoft\.NET\.Sdk\.Web/.test(csproj)) {
      f.framework = "ASP.NET Core";
      f.reasons.push({ code: "dotnet_web_sdk", file: main });
    }
    const tfm = /<TargetFramework>(net[\d.]+)<\/TargetFramework>/.exec(csproj)?.[1];
    if (tfm) f.reasons.push({ code: "dotnet_tfm", file: main, detail: tfm });
    for (const m of csproj.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) {
      for (const [re, engine] of NUGET_DB) if (re.test(m[1])) addDb(f, engine, `${main}: ${m[1]}`);
      if (/EntityFramework/i.test(m[1]) && !f.resourceHints.includes("orm")) f.resourceHints.push("orm");
    }
    if (/System\.Drawing|ImageSharp|SkiaSharp/i.test(csproj)) f.resourceHints.push("image_processing");
  }
  const settings = d.read("appsettings.json") ?? (main ? d.read(`${main.split("/").slice(0, -1).join("/")}/appsettings.json`.replace(/^\//, "")) : undefined);
  const launch = settings ? portFromDotnet(settings) : undefined;
  if (launch) f.port = { value: launch, source: "config" };
  return f;
}
