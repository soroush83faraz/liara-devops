import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags, GuardError, UsageError } from "./args";
import { EXIT, liaraFromEnv, type Env } from "./guards";
import { describeError, redactForOutput } from "./output";
import type { Io } from "./demo-cli";
import { formatTable, runSpike, type SpikeReport } from "./spike";

export const DEFAULT_OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/recorded");

export const SPIKE_USAGE = [
  "npm run spike -- [--app <name>] [--ai] [--rate-probe <n>] [--out-dir <dir>]",
  "",
  "  Read-only live checklist (GETs only; --ai adds tiny billed AI-gateway calls). Writes a REDACTED shape report to",
  "  tests/fixtures/recorded/spike-<date>.json and prints a pass/fail table for plan checklist items 1-13.",
  "  Needs LIARA_API_TOKEN (+ LIARA_TEAM_ID). --ai also needs LIARA_AI_BASE_URL, LIARA_AI_API_KEY, LLM_MODEL.",
  "  Load a .env file with: npx tsx --env-file=.env scripts/spike.ts <flags>",
  "  Mutating checks (4, 10, 13, domain add) are NOT run here: see tests/live (ALLOW_BILLED_LIVE_TESTS=1).",
].join("\n");

/** Serialises the report and refuses to write it if any known secret slipped through. */
export function writeReport(report: SpikeReport, dir: string, secrets: readonly string[]): string {
  const safe = redactForOutput(report, secrets);
  const text = JSON.stringify(safe, null, 2) + "\n";
  for (const s of secrets) if (s.length >= 6 && text.includes(s)) throw new Error("refusing to write the report: it contains a secret value");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `spike-${report.generatedAt.slice(0, 10)}.json`);
  writeFileSync(file, text);
  return file;
}

export interface SpikeDeps {
  env: Env;
  io: Io;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export async function runSpikeCommand(argv: readonly string[], deps: SpikeDeps): Promise<number> {
  const { env, io } = deps;
  try {
    const f = parseFlags(argv, { strings: ["app", "rate-probe", "out-dir"], booleans: ["ai", "help"] });
    if (f.booleans.help) throw new UsageError("help requested");
    const rate = f.strings["rate-probe"] === undefined ? 0 : Number(f.strings["rate-probe"]);
    if (!Number.isInteger(rate) || rate < 0 || rate > 60) throw new UsageError("--rate-probe must be an integer 0-60");

    let ai;
    if (f.booleans.ai) {
      const baseUrl = (env.LIARA_AI_BASE_URL ?? "").trim();
      const apiKey = (env.LIARA_AI_API_KEY ?? "").trim();
      const model = (env.LLM_MODEL ?? "").trim();
      if (!baseUrl || !apiKey || !model) throw new GuardError("--ai needs LIARA_AI_BASE_URL, LIARA_AI_API_KEY and LLM_MODEL");
      ai = { baseUrl, apiKey, model };
    }
    const client = liaraFromEnv(env, { fetchImpl: deps.fetchImpl });
    const token = (env.LIARA_API_TOKEN ?? "").trim();
    const teamId = (env.LIARA_TEAM_ID ?? "").trim();
    const fetchImpl = deps.fetchImpl ?? fetch;
    const rawGet = (path: string) =>
      fetchImpl(`${client.baseUrl}${path}?teamID=${encodeURIComponent(teamId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });

    io.out("spike: read-only checks against Liara (no mutations)...");
    const report = await runSpike({ client, app: f.strings.app, ai, rateProbe: rate, rawGet, fetchImpl: deps.fetchImpl, now: deps.now });
    const file = writeReport(report, f.strings["out-dir"] ? resolve(f.strings["out-dir"]) : DEFAULT_OUT_DIR, [token, ai?.apiKey ?? ""].filter(Boolean));
    io.out(formatTable(report.checks));
    io.out(`\nredacted shape report: ${file}`);
    const failed = report.checks.filter((c) => c.outcome === "fail").length;
    io.out(failed ? `${failed} check(s) failed: see the "what this changes" lines` : "no failed checks (skipped items need tests/live or extra flags)");
    if (report.endpoints.me?.kind === "auth") {
      io.err("Liara rejected the token (auth error on GET /v1/me)");
      return EXIT.liara;
    }
    return EXIT.ok;
  } catch (e) {
    const r = describeError(e);
    io.err(r.message);
    if (r.exitCode === EXIT.usage) io.err("\n" + SPIKE_USAGE);
    return r.exitCode;
  }
}
