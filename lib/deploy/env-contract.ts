// The single source of truth for environment variables. liara.json deliberately carries no env values:
// set them in the Liara console (Environment variables) or with `liara env set`. Messages are English and never
// contain a value, only variable names.

export type EnvMap = Readonly<Record<string, string | undefined>>;

export interface EnvSpec {
  name: string;
  /** The server cannot run safely in production without it. */
  requiredInProduction: boolean;
  /** Value is a credential: never log it, never return it. */
  secret: boolean;
  /** runtime: read by the server. dev-only / test-only: ignored (and warned about) in production. */
  scope: "runtime" | "dev-only" | "test-only";
  description: string;
  minLength?: number;
}

export const ENV_CONTRACT: readonly EnvSpec[] = [
  { name: "APP_SESSION_KEY", requiredInProduction: true, secret: true, scope: "runtime", minLength: 32, description: "Encrypts the session cookie (iron-session). 32+ random characters. Generate with: openssl rand -base64 48." },
  { name: "APP_APPROVAL_KEY", requiredInProduction: false, secret: true, scope: "runtime", minLength: 32, description: "Signs one-time approval tokens. Optional: derived from APP_SESSION_KEY via HKDF when empty; set it to rotate independently." },
  { name: "APP_ORIGIN", requiredInProduction: false, secret: false, scope: "runtime", description: "Comma-separated exact origins allowed to call mutating routes (CSRF check), e.g. https://hamyar.liara.run. Falls back to the request Host." },
  { name: "DATA_DIR", requiredInProduction: false, secret: false, scope: "runtime", description: "Directory for layouts, proposals, incidents and audit log. Must be the mount path of the Liara disk (liara.json mounts disk `data` at ./data, the default)." },
  { name: "LIARA_AI_BASE_URL", requiredInProduction: false, secret: false, scope: "runtime", description: "OpenAI-compatible Liara AI gateway base URL ending in /v1. Without it the copilot degrades to rule-based answers." },
  { name: "LIARA_AI_API_KEY", requiredInProduction: false, secret: true, scope: "runtime", description: "Bearer key for the AI gateway." },
  { name: "LLM_MODEL", requiredInProduction: false, secret: false, scope: "runtime", description: "Model id as listed by the gateway and included in the AI plan." },
  { name: "LLM_ROUTER_MODEL", requiredInProduction: false, secret: false, scope: "runtime", description: "Optional cheaper model for intent routing." },
  { name: "FALLBACK_AI_BASE_URL", requiredInProduction: false, secret: false, scope: "runtime", description: "Optional fallback OpenAI-compatible endpoint." },
  { name: "FALLBACK_AI_API_KEY", requiredInProduction: false, secret: true, scope: "runtime", description: "Key for the fallback endpoint." },
  { name: "FALLBACK_LLM_MODEL", requiredInProduction: false, secret: false, scope: "runtime", description: "Model id on the fallback endpoint." },
  { name: "PORT", requiredInProduction: false, secret: false, scope: "runtime", description: "Listen port; liara.json sets port 3000 and Next honours PORT." },
  { name: "TRUSTED_PROXY_HOPS", requiredInProduction: false, secret: false, scope: "runtime", description: "Reverse proxies in front of the server that append to X-Forwarded-For (default 1 = Liara's ingress). The login rate limiter trusts only the entry this many hops from the right; 0 = no proxy, forwarding headers are ignored." },
  { name: "NEXT_PUBLIC_COPILOT_MOCK", requiredInProduction: false, secret: false, scope: "dev-only", description: "Deterministic mock copilot stream. Inlined at build time and ignored in production builds." },
  { name: "LIARA_API_BASE_URL", requiredInProduction: false, secret: false, scope: "test-only", description: "Points the server at a fake Liara for e2e. Ignored when NODE_ENV=production." },
  { name: "LIARA_API_TOKEN", requiredInProduction: false, secret: true, scope: "test-only", description: "Live tests and spike scripts only. Never read by the running product." },
  { name: "LIARA_TEAM_ID", requiredInProduction: false, secret: false, scope: "test-only", description: "Live tests only." },
  { name: "LIARA_TEST_APP", requiredInProduction: false, secret: false, scope: "test-only", description: "Throwaway app live tests may modify." },
  { name: "ALLOW_BILLED_LIVE_TESTS", requiredInProduction: false, secret: false, scope: "test-only", description: "Allows live tests that create billed resources." },
  { name: "LLM_EVAL_MODELS", requiredInProduction: false, secret: false, scope: "test-only", description: "Comma-separated model ids for npm run eval." },
];

export const MIN_KEY_LENGTH = 32;

export type IssueLevel = "error" | "warn";
export interface ConfigIssue {
  level: IssueLevel;
  /** Stable machine code, safe to log and to assert on. */
  code: string;
  /** Variable name only; never a value. */
  name: string;
  message: string;
}

export interface EnvValidation {
  ok: boolean;
  issues: ConfigIssue[];
}

function isSet(env: EnvMap, name: string): boolean {
  return (env[name] ?? "").trim() !== "";
}

/** Pure production-environment validation. `ok` is false only when a required production setting is wrong. */
export function validateProductionEnv(env: EnvMap): EnvValidation {
  const issues: ConfigIssue[] = [];
  const add = (level: IssueLevel, code: string, name: string, message: string) => issues.push({ level, code, name, message });

  const session = env.APP_SESSION_KEY ?? "";
  if (session === "") add("error", "session_key_missing", "APP_SESSION_KEY", "APP_SESSION_KEY is not set.");
  else if (session.length < MIN_KEY_LENGTH) add("error", "session_key_short", "APP_SESSION_KEY", `APP_SESSION_KEY must be at least ${MIN_KEY_LENGTH} characters.`);

  const approval = env.APP_APPROVAL_KEY ?? "";
  if (approval === "") add("warn", "approval_key_unset", "APP_APPROVAL_KEY", "APP_APPROVAL_KEY is not set; approval tokens are derived from APP_SESSION_KEY.");
  else if (approval.length < MIN_KEY_LENGTH) add("warn", "approval_key_short", "APP_APPROVAL_KEY", `APP_APPROVAL_KEY is shorter than ${MIN_KEY_LENGTH} characters.`);

  if (!isSet(env, "DATA_DIR")) add("warn", "data_dir_default", "DATA_DIR", "DATA_DIR is not set; using ./data (must be the mounted disk path to survive restarts).");
  if (!isSet(env, "APP_ORIGIN")) add("warn", "app_origin_unset", "APP_ORIGIN", "APP_ORIGIN is not set; the request Host is used for the origin check.");
  const hops = (env.TRUSTED_PROXY_HOPS ?? "").trim();
  if (hops !== "" && !(/^\d{1,2}$/.test(hops) && Number(hops) <= 10)) {
    add("warn", "trusted_proxy_hops_invalid", "TRUSTED_PROXY_HOPS", "TRUSTED_PROXY_HOPS must be an integer from 0 to 10; using the default (1).");
  }

  const base = isSet(env, "LIARA_AI_BASE_URL");
  const key = isSet(env, "LIARA_AI_API_KEY");
  const model = isSet(env, "LLM_MODEL");
  if (!base && !key && !model) add("warn", "llm_unconfigured", "LIARA_AI_BASE_URL", "LLM is not configured; the copilot uses rule-based answers only.");
  else if (!(base && key && model)) add("warn", "llm_partial", "LIARA_AI_BASE_URL", "LLM configuration is incomplete (needs LIARA_AI_BASE_URL, LIARA_AI_API_KEY and LLM_MODEL); the copilot uses rule-based answers only.");

  for (const spec of ENV_CONTRACT) {
    if (spec.scope === "runtime" || !isSet(env, spec.name)) continue;
    const what = spec.name === "LIARA_API_BASE_URL" ? "is ignored in production" : spec.scope === "dev-only" ? "has no effect in production builds" : "is never read by the running product";
    add("warn", "ignored_in_production", spec.name, `${spec.name} is set but ${what}; remove it.`);
  }

  return { ok: !issues.some((i) => i.level === "error"), issues };
}
