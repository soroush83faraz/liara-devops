# همیار لیارا (Hamyar Liara)

A Persian, right-to-left, Railway-style console for [Liara](https://liara.ir) with an AI copilot for troubleshooting.
You connect with your own Liara API key (optionally a team ID), see apps, databases and private networks on a canvas,
open a service panel (logs, metrics, variables, domains, releases), watch a project-wide monitoring dashboard, and ask the
copilot why a site is broken. The copilot investigates with read-only tools, separates what it observed from what it
inferred, proposes a fix, and executes it **only after you approve**, then independently verifies the result and writes
an incident report.

```
 Connect (Liara API key [+ team ID], httpOnly cookie)
        |
        v
 +----------------------+     click a node      +---------------------------+     "همیار" tab / command bar
 |  Project canvas      | --------------------> |  Service panel            | -------------------------+
 |  apps, databases,    |                       |  overview, releases, logs |                          |
 |  networks, env edges |                       |  resources, variables,    |                          v
 |  live health probes  |                       |  domains, disks, settings |           +-------------------------------+
 +----------------------+                       +---------------------------+           |  Copilot                      |
        |  /observability (monitoring dashboard)                                         |  evidence -> findings ->      |
        |  /setup (setup assistant)                                                      |  proposal -> approval ->      |
                                                                                         |  execute -> verify -> report  |
                                                                                         +-------------------------------+
```

## Status at a glance

- **Verified live on real Liara on 2026-10-23** (team workspace): connecting with an API key and team ID, reading apps, networks, billing, metrics, logs, events, disks;
  deploying **this product itself** to Liara through its own code path (no Liara CLI); and the full rule-based troubleshooting loop
  (diagnose, approve, execute, verify) on deliberately broken demo apps (evidence record of the five runs: see `tests/fixtures/recorded/live-runs-2026-10-23.json`). The table in [What is verified live vs. offline](#what-is-verified-live-vs-offline)
  is the authoritative list.
- **Not verified live: the AI copilot.** No AI credentials were used. Every live run was **rule-only mode** (the copilot shows the `llm_unavailable` banner).
  The LLM path is implemented and tested offline with a scripted model; its behaviour on the Liara AI gateway is unknown.
- Tests: `npx tsc --noEmit` is clean; **2091 unit tests in 147 files** (2074 passed, 16 skipped live tests, 1 todo) (`npm test`), **237 Playwright e2e cases in 11 files** (`npx playwright test --list`).
  Exact results and the one timing-sensitive test: [Running tests](#running-tests).
- Docs: [architecture](docs/architecture.md), [Liara API matrix, quirks and costs](docs/liara-api.md), [demo guide and video script](docs/demo.md).

## The problem

Site owners on Liara who are not infrastructure specialists see "the site is broken" and have to cross-read
build logs, runtime logs, events, metrics, environment variables and DNS in several console pages, in English
jargon. Hamyar puts those in one Persian view and adds an assistant whose answers are tied to cited evidence,
whose proposed fixes need explicit approval, and whose "fixed" claim comes from probes, not from an API 200.

## Features by challenge area

### 1.1 Setup and deploy

| Capability | Where |
|---|---|
| Create network, app, database wizards with plan price (hourly x 720 = monthly) and type-the-name confirmation | `components/create/*`, `POST /api/ops`, `GET /api/plans` |
| Deploy an uploaded zip or tar.gz, or a Docker image, with live release/build logs | `POST /api/apps/[name]/deploy`, `GET /api/releases/[id]/stream` |
| Setup assistant: reads an uploaded project (package.json, requirements.txt, composer.json, go.mod, csproj, Dockerfile, .env.example), recommends platform, port, plan, optional database, env names, and builds one costed **DeployPlan** approved as a batch | `/setup`, `POST /api/setup/analyze`, `POST /api/setup/plan`, `lib/setup/*` |
| Domain doctor: shows the exact records Liara returns, Persian DNS/IRNIC steps, never claims DNS changed until `check` says so | Domains tab, `/api/domains/[id]/check` |
| Self-deploy script: ships this very product to Liara (network, app, disk, env, upload, release, probe) | `scripts/deploy-self.ts`, see [Deploy to Liara](#deploy-to-liara) |

The setup assistant's analysis, sizing and explanation are deterministic code (no LLM call in `lib/setup`).

### 1.2 Operations

| Capability | Where |
|---|---|
| Variables: list, add/edit/delete, `.env` import, masked values, reveal on demand; saved via read-merge-write-readback because `update-envs` replaces the whole list | Variables tab, `GET /api/apps/[name]/envs`, `POST .../envs/reveal`; edits go through `POST /api/ops` |
| Restart, stop/start, port, plan resize, toggles (zero-downtime, default sub-domain, fixed IP, read-only FS) | Settings tab, `GET /api/apps/[name]/settings`, `POST .../settings/toggle`; restart/stop/port/resize through `POST /api/ops` |
| Domains: add, check, SSL, redirect, remove | Domains tab, `/api/apps/[name]/domains`, `POST /api/domains/[id]/{check,redirect,ssl}`; removal is a tier-3 op |
| Disks: list, create, resize | Disks tab, `/api/apps/[name]/disks`, `POST .../disks/[disk]/resize` |
| Database panel: connection strings (password masked, explicit reveal), resize, power, public network, control panel, backups | `components/service/db/*`, `/api/dbs/[host]/*` |
| Audit log of every mutation (who, when, params hash, result) | `/activity`, `GET /api/audit` |

### 1.3 Monitoring

| Capability | Where |
|---|---|
| Railway-style **canvas** of apps, databases and networks (the project grouping Liara has), derived env-to-database edges (key name only), persisted layout, mobile list view | `/`, `GET /api/overview`, `components/canvas/*` |
| Live health: the server probes each app's **own** public address every 30 s while the page is open, with an in-app alert on change | `POST /api/probe`, `components/canvas/health-watch.tsx` |
| Logs (live tail over SSE, filter, level highlight, download), CPU/RAM/network charts, applets, events | Logs and Resources tabs, `/api/apps/[name]/logs`, `/logs/stream`, `/metrics`, `/events`, `/applets` |
| Releases and build-log viewer | Releases tab, `/api/apps/[name]/releases`, `/api/releases/[id]/*` |
| **Monitoring dashboard** («پایش»): time range, project filter, stacked CPU/RAM across services, per-service widgets (CPU/RAM/network, value vs plan limit, deployment markers) and a cross-service recent-errors panel; read-only, auto-refresh 30 s | `/observability`, `GET /api/observability`, `GET /api/observability/errors`, `components/observability/*`, `lib/observability/*` |

Liara has no webhooks or uptime API, so monitoring is **polling** and is labelled as such. Network metric units are unverified.

### 1.4 Troubleshooting (the copilot)

| Capability | Where |
|---|---|
| Deterministic evidence collection (status, applets, releases, events, logs, metrics, probe), extractors, evidence levels computed by rules; evidence is scoped to the **current release** so old-release errors do not pollute a diagnosis | `lib/evidence/*` |
| Bounded LLM step: intent routing, optional read-only tool calls, structured hypotheses; validated against the evidence; **works without an LLM (rule-based findings), which is the mode all live runs used** | `lib/agent/*`, `POST /api/agent` |
| Findings labelled **«مشاهده‌شده»** (observed), **«برداشت»** (inferred), **«نامشخص»** (unknown) with levels strong/medium/weak/insufficient | `components/copilot/*` |
| Proposal, approval dialog (tier, cost, secret-free diff, exact API call), one-time token, execution, verification (required checks per action + two independent positive signals; settling probe window; log check scoped to the new release; unknown/skipped never green), incident report with Markdown export | `/api/proposals/*`, `/api/incidents/*`, `/incidents` |

## What is verified live vs. offline

"Live" means run against the real Liara API on 2026-10-23 (team workspace) or, for read-only account checks, 2026-10-22. Details and raw shapes:
[docs/liara-api.md](docs/liara-api.md). Everything not in the live column below is implemented and offline-tested but **NOT live-verified**.

| Area | Verified live | Implemented and offline-tested, NOT live-verified |
|---|---|---|
| Auth and team mode | Bearer key; `?teamID=` returns `user` and `team` for `/v1/me` and `/v1/billing`; money and resources are the team's (`team.balance`) | Team-member permissions; rate-limit behaviour of Liara |
| Deploy of this product | Network create, app create, source tar.gz upload, release creation, build-log watch to READY, health check, disk mount, restart; no Liara CLI involved | `healthCheck` field of `liara.json` (our release body does not send it); redeploy of a previous release |
| Persistence | Disk on `data` mounted, `DATA_DIR` resolves to `/app/data` on the disk, data survives restart, `/api/health` reports `dataDirPersistent` | Disk resize, delete, backups by project `_id` (assumed) |
| Web security | Cookie `Secure; HttpOnly; SameSite`; CSP, HSTS and frame headers present; SSE not buffered (first byte 35 ms, 15 s heartbeat) | Multi-process locking (single process assumed) |
| Reads | Apps, releases, runtime logs v2, build logs v2, events, metrics (`since` unix seconds), disks, networks, billing | Network metric units; `oom` and `restart` event actions; DB reads (no database was created) |
| Troubleshooting loop (rule-only) | Five broken-app scenarios: missing-secret (diagnosis about 6 s, approve to verified about 44 s, 7 checks), wrong-port, crash-loop, build-failure, cpu-bound (evidence record: see `tests/fixtures/recorded/live-runs-2026-10-23.json`) | `db-unreachable`, `memory-leak`/OOM and domain flows; thresholds were calibrated on one 0.5 vCPU run and are heuristic |
| **AI copilot** | **Nothing.** The Liara AI gateway was never called; no AI credentials were used | Everything: tool loop, `json_schema` synthesis, Persian prose quality, fallback provider |
| Databases, domains, plans | Plan catalogue and prices (read) | DB create/backup/wire flows, domains and SSL, resize, plan changes |
| Rollback | Not supported by Liara | `redeploy_previous` (refused when no image/source exists) |

Mocks are never evidence of Liara support. The offline suite uses a typed Liara client with synthetic fixtures
(`tests/fixtures/liara/*.synthetic.json`) and a fake Liara for e2e (`tests/e2e/fake-liara.ts`); redacted live recordings are in `tests/fixtures/recorded/`.

Live-validation commands (need credentials; nothing runs without them):

| Command | What it confirms |
|---|---|
| `npm run spike` | Read-only (GET only) checks for checklist items 1, 2, 3, 6, 7, 8, 9, 11, 12; with `--ai` also item 5. Writes a **redacted shape report** to `tests/fixtures/recorded/` |
| `npm run test:live` | Same reads as tests, plus mutating items 4, 10, 13 and a domain add/remove, only with `ALLOW_BILLED_LIVE_TESTS=1` and a named throwaway app |
| `npm run eval` | 12 Persian prompts against the real LLM (`LLM_EVAL_MODELS`): intent, proposal type, forbidden actions, injection handling. **Not run** (needs an AI key) |
| `npm run seed:demo` / `reset:demo` | Deploy or re-apply a demo scenario on a real app (dry run unless `--yes`); gives the copilot something real to diagnose. See [docs/demo.md](docs/demo.md) |

Checklist and fallbacks per item: [docs/liara-api.md](docs/liara-api.md#live-validation-checklist).

## Quick start

Requires Node 22 (`liara.json` builds with Node 22; `package.json` allows >= 20).

### Local development against a fake Liara (no account needed)

```bash
npm install
npm run e2e        # Playwright starts a fake Liara (tests/e2e/fake-liara.ts) and the app with a mock copilot itself
```

For hand-driven UI work without credentials, run the same fake: the Playwright config (`playwright.config.ts`) shows how the app is
started with `LIARA_API_BASE_URL` pointing at the fake and `NEXT_PUBLIC_COPILOT_MOCK=1`. Both variables are dev/test-only and ignored in production.

### Local development against real Liara

```bash
cp .env.example .env.local    # fill in values; .env files are git-ignored
npm run dev                   # http://localhost:3000
```

1. Open `http://localhost:3000`; you are redirected to `/connect`.
2. Create an API key in the Liara console (account settings, API tokens; the exact menu name may differ) and paste it.
   **Team ID is optional**: enter it only for a team workspace. With a team ID every call carries `?teamID=` and the team's resources and wallet are shown
   (personal-only calls would see the personal wallet).
3. The key is checked with `GET /v1/me` and stored only in an encrypted httpOnly cookie (8 h).
4. For development, `APP_SESSION_KEY` may be empty (a random per-process key is used and sessions reset on restart). Production requires it.
5. Without `LIARA_AI_*` the copilot works in rule-based mode and shows the `llm_unavailable` banner. Set `NEXT_PUBLIC_COPILOT_MOCK=1` for a deterministic mock stream (dev only).

## Deploy to Liara

`scripts/deploy-self.ts` deploys **this repository** to Liara through the product's own executors and deploy code (`lib/actions`, `lib/liara/deploy.ts`:
source archive, upload, release, build-log watch). It is both a deploy tool and a live test of that path. It was used on 2026-10-23 to put the product on
`https://<app>.liara.run` with no Liara CLI. Run it from the repo root; credentials come from the **process** environment, so load `.env` explicitly.

```bash
# dry run (default): GET only; prints account, balance, plan, cost, env var names, archive size and the steps
npx tsx --env-file=.env scripts/deploy-self.ts
# first deploy (BILLED). g2 plans need a private network: the only existing one is used automatically; with none, pass --create-network <name>; with several, --network <name>
ALLOW_BILLED_LIVE_TESTS=1 npx tsx --env-file=.env scripts/deploy-self.ts --yes [--network <network-name> | --create-network <name>]
# redeploy fixed source to the existing app (upload + release + watch + probe only)
ALLOW_BILLED_LIVE_TESTS=1 npx tsx --env-file=.env scripts/deploy-self.ts --release-only --yes
# remove app and disk
ALLOW_BILLED_LIVE_TESTS=1 npx tsx --env-file=.env scripts/deploy-self.ts --destroy --yes --confirm-name <app>
```

| Flag / variable | Meaning |
|---|---|
| (none) | Dry run, GET only |
| `--yes` | Execute. Needs `ALLOW_BILLED_LIVE_TESTS=1`, balance >= 3x the 6-hour projected cost, cost <= `SPEND_CAP_TOMAN`. Creates app and disk `data`, sets `APP_SESSION_KEY`/`APP_APPROVAL_KEY` (generated, never printed), `TRUSTED_PROXY_HOPS=1`, `DATA_DIR=./data`, uploads, releases, watches (15 min cap), probes `/api/health` |
| `--network <name>` | Existing private network passed to app creation (required by g2 plans). Without it the script reads `GET /v1/networks`: exactly one network is used (and said so); none is a refusal that prints the `POST /v1/networks` command; several require `--network` |
| `--create-network <name>` | With `--yes`: create the private network first (free, 201) unless it already exists, then use it; not combinable with `--network` |
| `--release-only` | Only upload + release + watch + probe on an existing app; no create, disk, env, plan or balance gating; still needs `ALLOW_BILLED_LIVE_TESTS=1`; not combinable with `--network`, `--create-network` or `--destroy`. Refuses when the disk `data` cannot be looked up unless `--no-disk` |
| `--no-disk` | With `--release-only`: release without the persistent disk (data is then temporary) |
| `--destroy --confirm-name <app>` | Delete app and disk; the confirm name must equal the app name |
| `ALLOW_BILLED_LIVE_TESTS` | Must be `1` for any mutation |
| `SPEND_CAP_TOMAN` | Refuse when the projected cost exceeds it (default 50,000) |
| `APP_NAME` | App name (default `hamyar-liara`); **app names are globally unique on Liara** (409 if taken), so choose your own |
| `LIARA_API_TOKEN`, `LIARA_TEAM_ID` | Credentials; with a team ID the team wallet pays |

Prerequisites learned on the live run:

1. **A private network.** `small-g2` and the other g2 plans cannot be created without one (403 `g2_plan_unavailable`). Create it in the console or with `POST /v1/networks {networkName}`.
2. **A unique app name** (`APP_NAME`).
3. **A disk named `data`**, mounted at `data` (`liara.json`). The script creates it and sends `disks:[{name:'data',mountTo:'data'}]` in the release; the container cwd is `/app`, so `DATA_DIR=./data` is `/app/data` on the disk. Without it the filesystem is writable but temporary.
4. **A non-empty `public/` directory** (the repo ships `public/humans.txt`): the Next platform build fails with `COPY failed: stat app/public` otherwise.
5. **Test config files must not be uploaded without `tests/`**: `.liaraignore` excludes `playwright.config.ts`, `vitest.config.ts` and `tests` together, or `next build` fails type checking.
6. **Patience**: builds take about 3-4 minutes; one live build ended TIMEDOUT at the packaging step and the retry passed.
7. **A funded balance.** Hourly cost seen live: `small-g2` 659.72 + basic bundle 381.94 = 1041.66 toman/hour, plus about 104.17 toman/hour per GB of disk (inferred from the first-hour charge 1145.83); the script's estimate, 6 h projection and 3x balance gate include the disk; see the [cost table](docs/liara-api.md#cost-table).

After deploy: set `APP_ORIGIN` to the `https://<app>.liara.run` origin if you want an explicit CSRF origin (otherwise the request Host is used), and optionally `LIARA_AI_*`.
`GET /api/health` returns 200 `{status, checks:{sessionKey, dataDir, dataDirPersistent: mounted|not_mounted|unknown, llmConfigured}}`; in production it returns **503**
when `APP_SESSION_KEY` is missing/short or `DATA_DIR` is not writable, and reports `degraded` (still 200) when the data dir is not on a mounted disk.
Spend goes to `scratch/spend-log.jsonl` (git-ignored). Manual alternative: create the app and disk `data` in the console, set the env vars, and run `liara deploy` from the repo root.

## Environment variables

Single source of truth: `lib/deploy/env-contract.ts` (validated at `/api/health`). Values are never logged.

| Name | Scope | Required in prod | Secret | Purpose |
|---|---|---|---|---|
| `APP_SESSION_KEY` | runtime | yes | yes | Encrypts the session cookie; 32+ chars (`openssl rand -base64 48`) |
| `APP_APPROVAL_KEY` | runtime | no | yes | Signs one-time approval tokens; derived from the session key via HKDF when empty |
| `APP_ORIGIN` | runtime | no | no | Exact origin(s) allowed to call mutating routes (CSRF check); falls back to request Host |
| `DATA_DIR` | runtime | no | no | Directory for layouts, proposals, incidents, audit; must be the disk mount in production (default `./data`) |
| `TRUSTED_PROXY_HOPS` | runtime | no | no | Number of reverse proxies that append to `X-Forwarded-For` (default `1`, Liara's ingress). The login rate limiter trusts only the entry that many hops from the right; `0` ignores forwarding headers. Must match the real proxy chain. |
| `LIARA_AI_BASE_URL` | runtime | no | no | AI gateway base URL ending in `/v1` (never called live so far) |
| `LIARA_AI_API_KEY` | runtime | no | yes | AI gateway key |
| `LLM_MODEL` | runtime | no | no | Model id included in your AI plan (default in code: `anthropic/claude-sonnet-5.5`) |
| `LLM_ROUTER_MODEL` | runtime | no | no | Optional cheaper model for intent routing |
| `FALLBACK_AI_BASE_URL`, `FALLBACK_AI_API_KEY`, `FALLBACK_LLM_MODEL` | runtime | no | key only | Optional second OpenAI-compatible provider |
| `PORT` | runtime | no | no | Listen port (`liara.json` uses 3000) |
| `NEXT_PUBLIC_COPILOT_MOCK` | dev-only | no | no | Mock copilot stream; ignored in production builds |
| `LIARA_API_BASE_URL` | test-only | no | no | Points the server at a fake Liara for e2e; ignored in production |
| `LIARA_API_TOKEN`, `LIARA_TEAM_ID` | test-only | no | token | Live tests and spike/seed/deploy-self scripts only; never read by the running product |
| `LIARA_TEST_APP` | test-only | no | no | Throwaway app that live tests may modify |
| `ALLOW_BILLED_LIVE_TESTS` | test-only | no | no | Set to `1` to allow live tests, `seed:demo --create` and `deploy-self --yes` to create billed resources |
| `SPEND_CAP_TOMAN`, `APP_NAME` | script-only | no | no | `deploy-self.ts` spend cap and app name |
| `LLM_EVAL_MODELS` | test-only | no | no | Comma-separated model ids for `npm run eval` |

Also read by the live tests only: `LIARA_AI_MODEL` (item 5 model) and `LIARA_TEST_DOMAIN` (domain add/remove test).
Neither is in the env contract.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development server / production build / production server |
| `npm run lint`, `npm run typecheck` | ESLint, `tsc --noEmit` |
| `npm test` | Vitest unit and mocked-integration suite (`tests/unit`, skipped live suite) |
| `npm run e2e` | Playwright against a fake Liara and mock copilot (starts both servers itself; needs Chrome or `E2E_CHROMIUM=bundled`) |
| `npm run test:live` | Live suite, skipped without `LIARA_API_TOKEN` |
| `npm run eval` | Agent eval with a real LLM, skipped without `LIARA_AI_BASE_URL` + key |
| `npm run spike` | Read-only live checklist; `-- --app <name> --ai --rate-probe <n>` |
| `npm run seed:demo` | Deploy a demo scenario; dry run by default, `--yes` to act, `--create` for billed creation |
| `npm run reset:demo` | Re-apply a scenario (or `--scenario healthy`) to an existing app |
| `npx tsx --env-file=.env scripts/deploy-self.ts` | Deploy this product to Liara, see [Deploy to Liara](#deploy-to-liara) |

## Repository layout

```
app/                  routes: (shell) setup, observability, incidents, activity; connect; api/** (see docs/architecture.md)
components/           ui/ (kit), shell/, canvas/, observability/, service/{app,db,copilot}/, create/, setup/, copilot/
lib/liara/            typed Liara client, zod schemas, deploy (archive, upload, release watch)
lib/evidence/         collectors, extractors, evidence levels, temporal correlation
lib/agent/            pipeline, prompts, read-only tools, provider factory, synthesis
lib/actions/          executors, verification, proposals flow, incidents, audit hooks
lib/observability/    monitoring dashboard aggregation and chart maths
lib/security/         redaction, injection hygiene, approval tokens, state machine, policy, file store
lib/canvas/           overview aggregation, probe (SSRF guard), layout
lib/setup/            project detection, plan recommender, DeployPlan builder
lib/deploy/           env contract, health, security headers
lib/i18n/             fa.ts dictionary, glossary, number/date helpers
demo-app/             8 scenario apps + scenarios.json        scripts/   deploy-self, spike, seed-demo, reset-demo
tests/                unit/, e2e/, live/, eval/, fixtures/    docs/      architecture, liara-api, demo
```

## Running tests

Results recorded 2026-10-23.

| Suite | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | clean (exit 0) |
| Unit + mocked integration | `LIARA_API_TOKEN= LIARA_TEAM_ID= npx vitest run` | 147 files (146 passed, 1 skipped); **2091 tests**: 2074 passed, 16 skipped, 1 todo, 0 failed. `tests/unit/evidence/rules-redaction-perf.test.ts` ("5k log lines ... < 200 ms") is a wall-clock threshold and can fail on a loaded machine |
| E2E (fake Liara, mock copilot) | `npm run e2e` | **237 cases in 11 files** listed by `npx playwright test --list` (setup + desktop + mobile projects); the full suite was not executed for this documentation refresh |
| Live | `npm run test:live` | 16 skipped without credentials (counted inside the unit total above). Live evidence for this release comes from the 2026-10-23 manual runs recorded in [docs/liara-api.md](docs/liara-api.md), not from this suite |
| Agent eval | `npm run eval` | not run (needs an LLM key) |

Clearing `LIARA_API_TOKEN` and `LIARA_TEAM_ID` matters: with real credentials in the shell the live suite would try to run.

## Security summary

- The Liara API key lives only in an encrypted httpOnly cookie and server memory; it is not in any client payload, log or error text. The cookie is `Secure; HttpOnly; SameSite` (checked live on the deployed app).
- **Tiered approval.** Tier 1 one confirm; tier 2 type the resource name plus a cost line; tier 3 deletes are human-only (UI route), never proposable by the AI.
- **The AI cannot mutate.** The agent receives a client that rejects every non-GET request; its tools are read-only; proposal parameters are built by code, not copied from model output.
- **One-time approval tokens**: HMAC over proposal, account, target, type, params hash, nonce and expiry (10 min); nonce burned on use; exactly-once execution gate; mutations are never auto-retried.
- **Redaction** before anything reaches the LLM, UI persistence, audit log or incident: auth headers, key/JWT patterns, `password=` forms, credentialed URLs, and all known env values and DB passwords by exact match.
- **Logs are untrusted data**: wrapped as inert text, instruction-like lines are flagged and withheld from the model, and no model output can trigger execution.
- **CSRF and SSRF**: strict same-origin check on every mutating route; the health probe can only target an app's own Liara-derived domain and rejects private addresses.
- Security headers (CSP, HSTS in production, frame-ancestors none; seen live) and an audit log of every mutation. Operator scripts (`deploy-self`, `seed-demo`) refuse billed actions without `ALLOW_BILLED_LIVE_TESTS=1`, a spend cap and a typed confirm for deletes, and never print generated secrets.
- Rotate the Liara API key after recording a demo or sharing logs; the key is never written to the repo (a quality test scans for credential patterns).

Threat table with the covering test file for each: [docs/architecture.md](docs/architecture.md#security-model-and-threat-table).

## Known limitations

- **The AI copilot is not live-verified.** Rule-only mode is what ran live; the LLM path (tool loop, structured synthesis, Persian prose) is offline-tested only.
- Liara has no rollback API. `redeploy_previous` redeploys an older release by image or stored source and is refused, not faked, when neither exists; it is untested live.
- **Liara-side defect:** `GET /v1/projects/{name}/applets` returns HTTP 500 for our apps, so instance (applet) state is unavailable. The product degrades honestly: `app_running` falls back to app detail + release state, `restart_observed` to container events, and the verification card marks `applets_available` as **unknown**; see [architecture](docs/architecture.md#verification-rule).
- Not run live: `db-unreachable`, `memory-leak`/OOM and domain flows; database create/wire/backup; resize and plan changes; SSL; team-member permission differences. `oom`/`restart` events were not observed.
- CPU/RAM thresholds are heuristics calibrated on **one** 0.5 vCPU run; network metric units are unverified.
- No webhooks or uptime API: health is polling (30 s) while a browser tab is open; there is no background monitor.
- Stale data is shown as stale, never as current: when a canvas refresh fails the cached map stays with a persistent
  «آخرین به‌روزرسانی ناموفق بود — داده‌ها قدیمی‌اند (ساعت …)» banner and a retry (429 counts down and retries itself);
  a probe result older than two intervals turns into an amber «قدیمی · آخرین بررسی …» badge; a 401 on the probe stops
  polling and asks to reconnect. Apps without a public address are «قابل بررسی نیست» (grey), never "failed".
- `update_port` cannot be read back (Liara exposes no port setting), so it ends `not_verified` («قابل اثبات نیست»)
  unless the current release reports the requested port. Verification needs every required check plus two
  independent positive signals; see [Verification rule](docs/architecture.md#verification-rule).
- Single-process assumption: the file store, rate limiters, target locks and proposal events live in one Node process (not locked across processes). A Liara disk attaches to one app instance; do not run multiple replicas.
- Redaction and injection detection are heuristic pattern matchers. Over-redaction is accepted; the real boundary is "no mutating tool + approval token".
- The setup assistant is rule-based (no LLM explanation); DB restore, password reset, DNS zone editing, shell/exec, billing top-up and team management are not built.
- Cost: a deployed instance bills about 1,042 toman/hour (about 25,000 per day) plus disk; delete demo resources when done.

## License

License: TBD (placeholder; no license has been chosen for this hackathon submission).
