# Architecture

Companion to the [README](../README.md). API facts and verification status live in [liara-api.md](liara-api.md);
the demo procedure is in [demo.md](demo.md). Everything here describes code that exists in this repository.
**Live status (2026-10-23, real Liara, team workspace):** the deploy path, disk persistence, the read endpoints, team mode and the rule-only
troubleshooting loop (diagnose, approve, execute, verify) ran live. The **AI copilot did not**: no AI credentials were used, every live run was
rule-only mode (`llm_unavailable` banner), and the LLM path in this document is implemented and offline-tested only. See README,
"What is verified live vs. offline", and mark claims accordingly.

## Contents

1. [Component diagram](#component-diagram)
2. [Module map](#module-map)
3. [Data flows](#data-flows) (connect and canvas, investigate-approve-verify, setup assistant, self-deploy)
4. [Agent design](#agent-design)
5. [Security model and threat table](#security-model-and-threat-table)
6. [Persistence](#persistence)
7. [Error handling and degradation](#error-handling-and-degradation)
8. [Observability](#observability)
9. [RTL and Persian design rules](#rtl-and-persian-design-rules)
10. [Design decisions and rejected alternatives](#design-decisions-and-rejected-alternatives)

## Component diagram

One Next.js 16 App Router application. Browser code never talks to Liara; every call goes through a route
handler wrapped by `api()` (`lib/server/liara.ts`), which enforces same-origin on non-GET requests and a valid
session before the handler runs.

```
Browser (RTL, React 19, TanStack Query, Zustand, xyflow)
  canvas -> service panel (registry of tabs) -> copilot tab / command bar
        |  fetch / SSE (same origin, cookie hl_session)
        v
Route handlers  app/api/**   api(): origin check -> requireSession() -> handler
  read routes ------------------+  mutating routes: lib/actions/http/* (strict origin, rate limit, schema, policy)
        |                       |
        v                       v
lib/service/*, lib/canvas/*    lib/actions  (executors, verify, proposals flow, incidents)
        |                       |                 ^ approval token (lib/security/tokens)
        |                       |                 |
        |                lib/agent  --- readOnlyLiara(client) ---> lib/evidence (collect, extract, levels)
        |                       |                                   |
        |                       +--> LLM (Liara AI gateway, OpenAI-compatible chat completions, optional)
        v                       v
   lib/liara  typed client (GET retry, concurrency 3, LiaraError) ----> https://api.liara.ir
        |
   lib/security  redact / injection / policy / state machine / file Store  ---> DATA_DIR (Liara disk)
```

## Module map

| Module | Responsibility | Key files |
|---|---|---|
| `lib/liara` | Own typed client: auth + `teamID`, timeouts, GET-only retry with 429 backoff, concurrency cap 3, lenient zod schemas, deploy (zip to tar.gz, source upload, release watcher) | `core.ts`, `apps.ts`, `databases.ts`, `deploy.ts`, `logs.ts` |
| `lib/evidence` | Pure analysis of what Liara returned: collectors (IO) and extractors/levels/temporal correlation (pure) | `collect.ts`, `extract/*`, `levels.ts`, `temporal.ts`, `hypotheses-rules.ts` |
| `lib/agent` | Copilot pipeline: intent routing, target resolution, pass 2 tool loop, synthesis, merge/validation, proposal building, SSE emitter | `orchestrate.ts`, `route-intent.ts`, `tools.ts`, `synthesize.ts`, `propose.ts`, `readonly-liara.ts` |
| `lib/actions` | Executors for every action type, post-action verification, proposal approve/execute flow, incidents, audit hooks | `executors.ts`, `proposals.ts`, `verify*.ts`, `incidents.ts`, `http/*` |
| `lib/security` | Redaction, injection hygiene, approval tokens, proposal state machine, policy gates (CSRF, typed name, rate limit), file/memory store, audit | `redact.ts`, `tokens.ts`, `state-machine.ts`, `policy.ts`, `store.ts` |
| `lib/contracts` | Shared zod types: `ACTION_POLICY`, proposals, observations, hypotheses, stream parts | `action.ts`, `proposal.ts`, `stream.ts` |
| `lib/observability` | Monitoring dashboard: per-service metrics + release markers aggregation (`aggregate.ts`), error-line scan, pure chart maths, hidden-service preference | `aggregate.ts`, `series.ts`, `markers.ts`, `prefs.ts` |
| `lib/canvas` | Overview aggregation (apps, DBs, networks, derived edges), health probe with SSRF guard, layout persistence | `overview.ts`, `probe.ts`, `ip-guard.ts`, `layout.ts` |
| `lib/setup` | Project archive reading (zip/tar.gz guards), platform/port/env detection, plan recommender, DeployPlan builder | `archive-core.ts`, `detect.ts`, `recommend.ts`, `plan.ts` |
| `lib/service`, `lib/create`, `lib/copilot` | Route helpers and client hooks for service tabs, wizards and the copilot UI | `app-read/*`, `app-config/*`, `db/*` |
| `lib/deploy` | Env contract, `/api/health` logic, security headers | `env-contract.ts`, `health.ts`, `security-headers.ts` |
| `components/` | `ui/` kit, `shell/`, `canvas/`, `service/{app,db,copilot}`, `create/`, `setup/`, `copilot/` | |

## Data flows

### 1. Connect and canvas

1. `POST /api/session` (same-origin, 10 attempts/min/IP): validates the key shape, calls `GET /v1/me` with an 8 s timeout and
   `redirect: "error"`, derives `accountId` (16 hex chars of a SHA-256 of the user identity) and stores
   `{token, teamId, accountId, userName}` in an iron-session cookie (httpOnly, SameSite=Lax, Secure in production, 8 h; flags seen live on the deployed app).
   The browser only ever receives `sessionPublicView()` (no token).
   **Team mode** (verified live): with a team ID every Liara call carries `?teamID=`. `GET /v1/me?teamID=` returns `user` (`isTeam:false`) and `team`;
   `GET /v1/billing?teamID=` returns both `user` and `team`, and the money and resources belong to the team, so the balance comes from `team.balance`
   (`lib/liara/account.ts`). If a team ID is set but the response has no `team` object, the balance is UNKNOWN and billed creates are refused
   (`team_balance_unreadable`); it never falls back to the personal wallet. Team-member permission differences are not verified.
2. `GET /api/overview` (polled every 30 s while visible) reads apps, databases, networks and balance with a concurrency cap,
   fetches details for up to 30 apps/DBs, and derives **edges**: an app env *value* containing a database's private
   `hostname[:port]` inside the same network yields an edge labelled with the env *key* only (`lib/canvas/overview.ts`).
   Partial failures are returned as `errors`, not as invented data.
3. The canvas schedules `POST /api/probe` per service every 30 s (backoff after 429). The probe host is derived server-side
   (custom domain with ACTIVE certificate, else default sub-domain); callers cannot supply a URL.
4. Node positions are saved per account in the `layouts` store namespace.

### 2. Investigate, propose, approve, execute, verify

```
POST /api/agent {text, history, target?}        (rate limit 10/min, max 2 concurrent runs per account, body cap)
  intent route (rules first; refuse/clarify/explain/setup_redirect short-circuit, no evidence, no tools)
  resolve target (app or database) via read-only Liara
  PASS 1  collect evidence in parallel -> extractors -> Observation[] (ids O1..) -> rule findings + levels
  PASS 2  only if an LLM is configured AND evidence has gaps: bounded read-only tool loop
  synthesis (structured output) -> citation validator -> merge with rule floor -> Finding (data-finding)
  proposal built by CODE from the top validated hypothesis (data-proposal), persisted as `proposed`
        |
        v   user opens the approval dialog (tier, cost, secret-free diff, exact call)
POST /api/proposals/[id]/approve  origin -> rate limit -> integrity -> status/policy -> state fingerprint (409 if stale)
                                  -> typed name (tier 2) -> proposed->approved -> mint one-time token
POST /api/proposals/[id]/execute  integrity -> policy -> user-supplied values -> fingerprint -> per-target lock
                                  -> verifyApprovalToken (burns nonce) -> claimExecution (approved->executing, CAS)
                                  -> background job, mutation sent once, never retried -> audit
GET  /api/proposals/[id]/events   SSE: execution steps, then verification checks
verify: app running (applets, or app detail + release state when the applets call is unavailable) on a READY release
        -> restart observed (applets, or container events) -> settling probe window: 3 CONSECUTIVE 2xx >= 5 s apart within 90 s
        -> originating error signature absent from logs of the NEW release only -> before/after snapshot (behavior_changed)
        -> verified | not_verified (names the failed or unproven check) | failed   (rule: see "Verification rule")
incident: finding + proposal + timeline + verification; GET /api/incidents/[id](/markdown)
```

Human-initiated operations (buttons in tabs) use `POST /api/ops`: the user's click plus the typed name (validated
server-side for tier >= 2) is the approval; tier-3 deletes exist only on this path. `deploy_plan` is refused there and
must go through the proposal flow because it streams progress for minutes.

### 3. Setup assistant to deploy plan

1. `POST /api/setup/analyze` receives a zip or tar.gz (streamed with a hard size cap), reads it in memory under archive
   guards, and runs detectors (`lib/setup/detectors/*`) for Node, Python, PHP, Go, .NET, Docker. Only env var *names*
   are retained from `.env*` files.
2. `lib/setup/recommend.ts` sizes RAM/CPU from platform and dependencies and picks the cheapest fitting plan from the real
   `/v1/me` plans, with machine-readable reasons; costs are hourly x 720.
3. `POST /api/setup/plan` re-validates every user choice against live plans/networks, builds a `DeployPlan`
   (create app, set env, deploy, optional database and wiring, domain guidance), stores it as a proposal (source `setup`)
   and returns `proposalId`, costs and the rule-based explanation.
4. The user approves once (tier 2, type the app name, enter secret values themselves); `execDeployPlan` runs the steps and
   verification follows the same state machine as flow 2. Wording is rule-based; there is no LLM call in `lib/setup`.

### 4. Self-deploy (`scripts/deploy-self.ts`)

The product deploys itself through the same code the UI uses, with no Liara CLI (verified live 2026-10-23):

```
dry run (GET only): me/billing (team-aware) -> plan + bundle + disk price (disk inferred) + 6 h projection -> private network (one: used; none: refused with the create command; several: --network) -> env var names -> archive size
--yes (needs ALLOW_BILLED_LIVE_TESTS=1, balance >= 3x projection, cost <= SPEND_CAP_TOMAN):
  [create_network if --create-network] -> create_app (executor, billed guard; g2 plan -> private network required) -> create disk `data` (by app NAME)
  -> set_env (APP_SESSION_KEY, APP_APPROVAL_KEY generated, TRUSTED_PROXY_HOPS, DATA_DIR) -> createSourceArchive (tar.gz, .liaraignore + forced files)
  -> uploadSource (POST /v2/projects/{name}/sources) -> createRelease ({sourceID, port, type:"next", disks:[{name:"data",mountTo:"data"}], platformConfig})
  -> watchRelease (release state poll + build logs v2, 20 lines/page, 15 min cap) -> probe https://<app>.liara.run/api/health
--release-only: upload + release + watch + probe on an existing app (refuses when the disk `data` cannot be looked up, unless --no-disk), then re-reads disks: PASS/FAIL "disk mounted"
--destroy --confirm-name <app>: delete disk(s) and app
```

Facts the live run established: g2 plans require a private network (403 `g2_plan_unavailable` otherwise); app names are globally unique (409); the Next
platform needs a non-empty `public/`; test configs must be excluded together with `tests/`; builds take about 3-4 min and one ended TIMEDOUT at packaging
(a retry passed); `GET /v1/projects/{_id}/disks` works by project `_id` and answers 500 by name, so every disk read/write except create resolves the `_id`
first (`lib/liara/disks.ts`); the container cwd is `/app`, so `DATA_DIR=./data` lands on the mounted disk, and data survived a restart. The release body does not
send `liara.json`'s `healthCheck` (unverified transform, and `curl` may be absent from the image); the script probes `/api/health` from outside instead.
Spend is appended to `scratch/spend-log.jsonl`. Mutations are sent once, never retried; secrets are generated server-side and never printed.

## Agent design

**One agent with a deterministic backbone.** The model interprets; code does everything that must be right.

| LLM (optional) | Deterministic code |
|---|---|
| Persian intent tie-breaks (only when keywords matched nothing), optional follow-up reads, hypothesis ranking and wording, a summary shown only in a labelled «خلاصه‌ی مدل (برداشت)» block after the code-built sections | Answer headline (from the validated top finding), certainty/claims filter on model prose, cause-appropriate citation screening, Auth, API calls, timeouts and retries, evidence collection, log parsing, signatures, time correlation, evidence levels, redaction, citation validation, allowlists, proposal building, approval tokens, state machine, execution, verification, audit |

**Tools** (`lib/agent/tools.ts`, zod-validated, at most 6 calls, 4 steps, 45 s total): `get_app_status`, `get_applets`,
`list_releases`, `get_release`, `get_runtime_logs`, `get_build_logs`, `get_events`, `get_metrics`, `probe_site`,
`get_db_status`, `get_db_metrics`, and `propose_action`. No tool takes a resource name (scope is the resolved target), all
outputs are redacted and wrapped as untrusted data, and `propose_action` only records an intent: intents are advisory,
logged as counts and **never used as parameters**. The pipeline receives `readOnlyLiara(client)`, which rejects every
non-GET request at transport level, so even a coding bug cannot mutate from the agent.

**Evidence levels** are computed by rules in `lib/evidence/levels.ts` (and re-checked by the contract schema), never taken
from model confidence:

| Level | Rule |
|---|---|
| strong (`شواهد قوی`) | signature observation AND onset within 5 min of a release/config change AND no contradiction |
| medium | exactly one of signature or correlation |
| weak | indirect support only |
| insufficient | no usable (known, unflagged) supporting observation |

A contradicting observation lowers the level by one and is shown. Observations flagged as possible injection are never used
as support. Statements in the UI are labelled observed (`مشاهده‌شده`), inferred (`برداشت`) or unknown (`نامشخص`).

**Evidence scoping by release** (`lib/evidence/analyze.ts`, `releaseScope`). The serving release is the API's `currentRelease` (top-level field of
`GET /v1/projects/{name}/releases`, verified live), falling back to the newest READY release. Runtime-log lines carry their release id
(`metaData.releaseId`); lines of the serving release and of newer releases count as current evidence, older-release lines are reported as ignored and are not
used as support. A failed newest build while an older release still serves is reported as exactly that (live: `build-failure` names the unresolvable package while
the old release keeps serving). Without a known current release no scoping is applied.

**Extractors** (`lib/evidence/extract/`): release-state, build-error, missing-env, config, connection (ECONN*, ENOTFOUND,
getaddrinfo, target), port-mismatch, crash, oom, db-state, metric, http-status, probe, applet-state, events,
injection-suspect. Causes recognised by the rule engine: missing_env, wrong_port, crash_after_release, build_failure,
db_unreachable, oom, cpu_saturation, external_dependency, transient_unknown.

**Resource rules** (`lib/evidence/extract/metric.ts`, `hypotheses-rules.ts`). Thresholds are heuristics calibrated on a
live 0.5 vCPU run (2026-10-23): a single-threaded Node handler burning CPU on every request plateaued at 0.30 cores
(60% of the plan) in 30-s averages while the probe timed out, so a 30-s average never reaches 100% for such an app.

- Every CPU sample is compared with the plan (`cores / planCpu`). **Pressure** = at least 2 consecutive samples >= 60%,
  or >= 40% of the window's samples (min. 3) >= 60%, or any sample >= 85%.
- The CPU observation is a `cpu_saturation` **signature** only when pressure is corroborated by a latency symptom
  (probe timeout, probe >= 3 s, probe 5xx, 5xx or >= 2 requests slower than 3 s in the access log) or is sustained
  (>= 70% of >= 3 samples at >= 80%). Otherwise it is an info/warn `cpu_elevated` fact and makes no hypothesis.
- Level: medium (signature). Strong only with a correlation: the slow requests of one path (access log, >= 3 slow
  requests, >= 60% of them) start within -60..+120 s of the CPU onset, or the onset falls within 5 min of a release
  with a calm sample before the release started and no high sample before it finished. Competing runtime errors
  (crash, connection error) or OOM are listed as contradictions (one level lower). The explanation says that a
  restart or more RAM does not help; investigating the slow handler or a bigger CPU plan is a labelled suggestion.
- Rolling restarts: CPU is judged on the applet whose newest sample is most recent (the serving container). Series
  are never summed, since the plan limit applies per container, and never spliced, which would create a false "sustained".
  Every applet's samples are kept only for the "calm before the release" check. Memory uses the busiest applet.
- RAM is blamed only with an OOM observation, and memory counts as a signature only at >= 85% of the plan or when it
  keeps growing above 70%.
- Proposals: none for `cpu_saturation`, except a tier-2, costed `resize` to a plan with more CPU when the pressure is
  sustained (>= 80%) AND corroborated. It never gets a restart, and a user's restart request gets "restart won't help".
  On weak or insufficient evidence (including the `transient_unknown` fallback) neither the rules nor the model propose
  a state-changing action; the answer asks for more evidence instead (check again in a minute, enable access logs).
  The one exception is human intent: a restart or stop the user explicitly REQUESTED in chat (`planAction` in
  `lib/agent/propose-plan.ts`) is still turned into a proposal. It stays approval-gated (tier 1, explicit approval),
  its rationale says it was proposed at the user's request ("no contrary evidence found") while the finding itself
  stays labelled weak; a restart that a medium/strong finding shows to be futile is still refused, and with no
  state evidence at all nothing is proposed.

**Proposal state machine** (`lib/security/state-machine.ts`):

```
proposed -> approved | rejected | expired | stale
approved -> executing | expired | stale
executing -> verifying | failed
verifying -> verified | not_verified | failed          (terminal: verified, not_verified, failed, rejected, expired, stale)
```

Proposals expire after 10 minutes (`PROPOSAL_TTL_MS`). "Fixed" is only ever `verified`, which requires observed checks;
API acceptance is not a check.

### Verification rule

Every check has a status: `passed`, `failed`, `unknown` (could not be observed: unreadable state, an empty log window,
nothing to compare against) or `skipped` (deliberately not performed, e.g. no HTTP probe for a non-web app). The
contract keeps `passed: boolean` for compatibility and `passed` is true only for `status: "passed"`. `unknown` and
`skipped` are never shown green (amber «قابل اثبات نیست», neutral «بررسی نشد») and never count as evidence.

`verified` requires all of:

1. every REQUIRED check for the action type passed (table in the header of `lib/actions/verify.ts`; e.g. restart:
   `app_running` + `restart_observed`; `update_port`: `app_running` + `port_readback`; delete: `resource_gone`);
2. no required check is `unknown`/`skipped`, and no check at all `failed`;
3. at least two INDEPENDENT positive signals for runtime fixes (sources: state, HTTP probe, logs, config read-back;
   two checks from the same source count once), or the direct read-back for pure state changes (create/delete/stop).

Otherwise the outcome is `not_verified` and names what could not be proven (an `independent_signals` check is added
when only one source confirmed the change). Consequences: a restart whose before-snapshot has no instance names is
proven only by start times after the change, else `restart_observed` is `unknown`; "error absent in 0 log lines" is
`unknown`, not a pass; the log-signature check is required whenever the originating error is known (cited evidence);
`update_port` is `not_verified` unless the current release reports the requested port, because Liara exposes no port
setting to read back. Only `verified` may print «مشکل برطرف شد».

**Design points confirmed on the live `missing-secret` run (rule-only mode, diagnosis about 6 s, approve to `verified` about 44 s, 7 checks):**

- *Settling probes.* `probe_2xx` is a window, not three instant shots: 3 consecutive 2xx at least 5 s apart must occur within 90 s (`VERIFY_PROBE_WINDOW_MS`),
  because a restarting app answers 502/503 for a while. After a definitive failure there is no window, just one plain series.
- *Release-scoped log check.* `error_signature_absent` judges only log lines of the NEW release (and, without release info, lines after the observed restart);
  earlier lines are reported as ignored, so the old release's error cannot fail the check and an empty window is `unknown`, not a pass.
- *`behavior_changed`.* For `set_env` the probe status before (5xx) is contrasted with after (2xx); disclosed, same "probe" source, never required.
- *Applets unavailable (Liara-side).* `GET /v1/projects/{name}/applets` returns HTTP 500 for our apps (by `_id`: 404), so `applets_available` is `unknown` and is shown as such.
  `app_running` is then proven from app detail (`status: ACTIVE`) plus the newest release state, and `restart_observed` from the container events
  (`create/start/kill/die/stop/destroy` seen live; `oom` and `restart` actions not yet observed). Both fallbacks are named in the check's detail string. This path is why the live
  verification has 7 checks: `env_keys_applied`, `applets_available` (unknown), `app_running`, `restart_observed`, `probe_2xx`, `behavior_changed`, `error_signature_absent`.
- *Crash-loop evidence from events.* `die+start` repeated 5 times within 60 s is read from events and reported with the TypeError and its file:line from logs; no automatic fix is proposed.

**Action tiers** (`ACTION_POLICY` in `lib/contracts/action.ts`, frozen):

| Action | Tier | AI may propose | Billed | Typed name | Reversible |
|---|---|---|---|---|---|
| `restart`, `set_env`, `unset_env`, `scale`, `update_port` | 1 | yes | no | no | yes / partly |
| `resize`, `deploy_plan` | 2 | yes | yes | yes | partly |
| `redeploy_previous`, `wire_db` | 2 | yes | no | yes | partly |
| `create_app`, `create_db` | 2 | no (UI only) | yes | yes | partly |
| `create_network` | 2 | no (UI only) | no | yes | no |
| `delete_app`, `delete_db`, `delete_domain`, `delete_disk` | 3 | never | no | yes | no |

Reads and probes are tier 0 (automatic, shown in the timeline). Shell access and DNS zone edits have no code path.

## Security model and threat table

Trust boundaries: the browser is untrusted; Liara responses and logs are untrusted data; the LLM is untrusted output.
The boundary that matters is "no mutating tool + approval token"; heuristics (redaction, injection flags) are defence in depth.

| Threat | Mitigation | Covered by |
|---|---|---|
| Prompt injection via logs, build output, events | Text is NFKC-cleaned, wrapped in an inert `<untrusted_log>` block with `& < >` entity-escaped so no wrapper can be closed or forged; instruction-like lines are flagged, withheld from the model (count only) and never used as evidence; model has no mutating tool; proposals are built by code; refusals (delete, shell, cross-app) happen before any evidence or model call | `tests/unit/security/injection.test.ts`, `tests/unit/agent/routing-safety.test.ts`, `tests/unit/agent/llm.test.ts`, `tests/unit/evidence/scenarios.test.ts` |
| API key theft | Key only in an encrypted httpOnly cookie (iron-session) and server memory; browser gets a token-free public view; errors, bodies and URLs never contain it; repo scanned for credential patterns | `tests/unit/ui/session.test.ts`, `tests/unit/liara/core.test.ts`, `tests/unit/quality/secrets.test.ts` |
| CSRF | Every mutating route checks `Sec-Fetch-Site` and `Origin` against `APP_ORIGIN` or the request host (SameSite cookies alone are insufficient on shared `*.liara.run`) | `tests/unit/security/policy.test.ts`, `tests/unit/actions/ops-http.test.ts` |
| SSRF in the health probe | Target derived from Liara data only (never from input); hostname must be a public-looking DNS name; resolved addresses rejected if private, loopback, link-local, CGNAT, multicast, NAT64 or v4-mapped; bounded redirects, body and time | `tests/unit/canvas/probe.test.ts` |
| Zip-slip / archive bombs | Entry paths with `..`, absolute, drive-letter, NUL or backslash tricks rejected; symlinks refused; limits on size, entry count, depth and compression ratio; archives are read in memory, never extracted to disk; source tar rebuilt from validated entries | `tests/unit/setup/archive.test.ts`, `tests/unit/liara/deploy.test.ts`, `tests/unit/create/deploy-request.test.ts` |
| XSS (log text, model prose, names) | React text nodes only; model/markdown rendered through `components/copilot/safe-markdown`; a quality test forbids `dangerouslySetInnerHTML`, `innerHTML` and `document.write`; CSP with `frame-ancestors 'none'`, `object-src 'none'` (script-src keeps `'unsafe-inline'` because Next emits inline scripts; this is a known compromise) | `tests/unit/quality/no-dangerous-html.test.ts`, `tests/unit/copilot/markdown.test.ts`, `tests/unit/deploy/security-headers.test.ts` |
| Replay of approvals | Token = HMAC-SHA256 over proposal, account, target, type, params hash, 128-bit nonce, expiry; signature checked in constant time before claims; nonce consumed only by a fully valid token; one failure code to clients | `tests/unit/security/tokens.test.ts`, `tests/unit/actions/proposal-flow.test.ts` |
| Double submit / races | Atomic compare-and-set `approved -> executing` (`claimExecution`), per-target lock, state fingerprint re-checked at confirm time (stale -> 409), mutations sent once and never auto-retried; on an ambiguous outcome the real state is re-read before reporting | `tests/unit/security/state-machine.test.ts`, `tests/unit/actions/mutation.test.ts`, `tests/unit/actions/proposal-flow.test.ts` |
| Secret leakage to the LLM | The model sees env *keys* only; digest holds ids, kinds and short params; all tool output passes the run redactor, which also scrubs known env values and DB passwords by exact match (URL- and JSON-escaped forms too); DB `root_password` stripped at parse time; env changes in proposals carry a key and a value *source* (`user` typed in the approval dialog, `generated` server-side, or `existing` copied server-side); the strict schema rejects any literal `value`, so a model cannot express one | `tests/unit/security/redact.test.ts`, `tests/unit/actions/secrets.test.ts`, `tests/unit/actions/env.test.ts`, `tests/unit/evidence/rules-redaction-perf.test.ts` |
| AI-initiated destructive action | `AiProposableActionParamsSchema` cannot express creates or deletes; policy table frozen; `assertAiMayPropose`; tier-3 only via `/api/ops` with typed name | `tests/unit/contracts/action.test.ts`, `tests/unit/security/policy.test.ts` |
| Misconfiguration in production | `/api/health` returns 503 without a valid `APP_SESSION_KEY` or writable `DATA_DIR`; env contract warns about ignored dev/test variables | `tests/unit/deploy/health.test.ts`, `tests/unit/deploy/env-contract.test.ts` |

Headers and cookie were checked live on the deployed instance: session cookie `Secure; HttpOnly; SameSite`, CSP, HSTS and frame-ancestors present, and the
SSE routes are not buffered by Liara's ingress (first byte 35 ms, heartbeat every 15 s). Operator scripts (`deploy-self`, `seed-demo`) add their own guards:
`ALLOW_BILLED_LIVE_TESTS=1`, a spend cap, a balance-to-cost ratio, typed confirmation for deletes, no secret printing. Not verified: Liara-side rate limits, team-member permissions.

## Persistence

`Store` (`lib/security/store.ts`) has two implementations on one engine: JSON files under `DATA_DIR` (default `./data`,
a Liara disk in production) and an in-memory map for tests. Namespaces: `layouts`, `proposals`, `nonces`, `incidents`, `audit`.

- Directories are named by a hash of the account id; document ids must match `^[a-zA-Z0-9_-]{1,64}$` and resolved paths are re-checked.
- Writes are atomic (temp file + rename, mode 0600) and serialised per account and collection by an in-process mutex.
- Values are schema-validated on write and read; a corrupt proposal or nonce file **fails closed**.
- Size limits per document and per collection; unreadable or evictable (terminal) documents are removed oldest-first before refusing with `full`. The audit log is JSONL with size-based rotation.
- **Disk (verified live).** On Liara the release carries `disks:[{name:'data',mountTo:'data'}]`; the container cwd is `/app`, `DATA_DIR` resolves to `/app/data`, and that path is on the
  mounted disk. Data survived a restart. `GET /api/health` reports `checks.dataDirPersistent` as `mounted|not_mounted|unknown` by reading `/proc/self/mountinfo`; `not_mounted` in
  production yields `status: "degraded"` (HTTP 200, not 503, because a restart would not help). Liara's Next platform filesystem is writable but temporary outside disks.
- **Single-process assumption (not locked across processes)**: the mutex, rate limiters, target locks and SSE event hub are per process. A Liara disk
  attaches to one app, so run one instance. Losing the disk loses history (layouts, incidents, audit) but not correctness:
  pending approvals simply expire.

## Error handling and degradation

| Situation | Behaviour |
|---|---|
| No LLM configured, or key/quota/rate-limit/timeout/server error from the gateway | One retry on the fallback provider if configured, then rule-only findings with a degrade banner; deterministic evidence, levels and proposals still work |
| Gateway rejects tool calling | Pass 2 is skipped; synthesis proceeds on the PASS 1 digest |
| Gateway rejects `json_schema` or returns invalid output | Synthesis retried as JSON-in-text parsed by zod; failing that, rule-only |
| Model cites unknown or flagged observation ids | Citations dropped by the validator; a hypothesis left uncited is discarded |
| Model cites facts that cannot indicate its cause (e.g. "memory normal" for RAM exhaustion) | Non-indicative citations dropped, contradicting ones moved to `contradicts`; a model-only hypothesis left without an indicative support is discarded (`INDICATIVE`/`CONTRADICTING` in `lib/evidence/levels.ts`) |
| Model asserts certainty or recommends an unvalidated action | Sentence dropped by `lib/agent/claims-filter.ts` (count shown); a rule-backed explanation is never replaced, model text is only appended as «توضیح تکمیلی مدل» |
| Every evidence source fails | Headline «نتوانستیم شواهدی جمع کنیم», limits say all sources failed; never «نشانه‌ای از خطا دیده نشد» |
| One Liara read fails (logs, metrics, events...) | Recorded as a failed source and an explicit `نامشخص` item; findings state the evidence is incomplete; never fabricated |
| Liara 401 / 403 / 404 / 409 / 429 / 5xx | Normalised `LiaraError` kinds mapped to Persian messages; GETs retried with backoff, mutations never; 429 shows a countdown |
| Mutation answer lost (timeout, 5xx) | Real state re-read; confirmed -> continue, otherwise `outcome_unknown` with no retry |
| Verification cannot confirm | `not_verified` naming the failed or unproven check, or `failed`; never reported as fixed |
| Canvas refetch fails while data is cached | Persistent banner «آخرین به‌روزرسانی ناموفق بود — داده‌ها قدیمی‌اند (ساعت …)» with retry; 502/504 mapped, 429 counts down and retries |
| Probe call fails / 401 | Badge turns amber «قدیمی · آخرین بررسی …» after 2x the interval; 401 stops probing and asks to reconnect. No URL / refused address / never-resolved name is a grey «قابل بررسی نیست», never a failure or alert |
| `DATA_DIR` unwritable | `/api/health` 503 in production (Liara restarts), error banner in dev |
| `DATA_DIR` writable but not on a mounted disk | `/api/health` 200 with `status: "degraded"` and `dataDirPersistent: "not_mounted"`; history is lost on restart |
| Applets call returns 500 (Liara-side, verified live) | Evidence source `applets` marked failed -> explicit `نامشخص`; verification `applets_available` = `unknown`, `app_running` from app detail + release, `restart_observed` from events; `GET /api/apps/{name}/applets` answers 502; never reported as "no applets" |
| Disk list 500 by name (verified live) | Disk reads go through the project `_id`; a lookup failure makes `deploy-self --release-only` refuse (unless `--no-disk`) |
| Build ends TIMEDOUT at packaging (seen once live) | Shown as a terminal failed release with its `failReason`; a retry is a new release; nothing is auto-retried |
| `g2` plan without private network (403 `g2_plan_unavailable`) / name taken (409) | Normalised `LiaraError` (`forbidden` / `conflict`) with a Persian message; the create wizard and `deploy-self` need a network and a unique name |

LLM budgets (`lib/agent/provider.ts`): input capped at 24,000 characters, tool loop 4 steps / 6 calls / 45 s, synthesis 45 s.

## Observability

- **Audit log** (`audit` namespace, JSONL): every mutation attempt with actor, action, target, params hash, result and redacted detail; read at `/activity` and `GET /api/audit`. Params are hashed, never stored.
- **Incidents** (`incidents` namespace): finding, proposal, timeline and verification per investigated problem, free text redacted before persisting; `/incidents`, `/incidents/[id]`, Markdown export.
- **Logs**: server logs are English, carry error codes and variable *names* only; LLM usage logs count tokens, not prompts. A quality test forbids `console` in the actions module (`tests/unit/actions/no-console.test.ts`).
- **Health**: `GET /api/health` with `status`, `version`, `uptimeSec`, `checks`.

### Monitoring dashboard (`/observability`, «پایش»)

Read-only, project-level view of every service's resources, one page like Railway's Observability tab.

- **Data flow.** `GET /api/observability?range=15m|1h|6h|24h[&network=<id>]` takes the services from the canvas overview (same cache entry as `GET /api/overview`, so no extra per-app detail calls), filters by network, sorts problems first, and keeps at most 12 (`truncated:{shown,total}` is always returned). For each service it calls the same Liara endpoints as the per-service tabs (`assembleMetrics`: cpu, memory, network-receive/transmit series plus the summary call; apps also `listReleases`, newest 10, for deployment markers) and attaches the plan limit from `/v1/me`. `GET /api/observability/errors` scans each app's runtime logs for the window (newest 1000 lines), masks them in one batch (pattern rules + the app's own env values, `lib/service/app-read/known-secrets.ts`) and returns the last 5 ERROR/stderr lines per app. Errors are a separate request so the log scan never delays the charts.
- **Limits and caching.** Services are processed 3 at a time on top of the Liara client's own cap of 3 in-flight requests. Responses are cached 15 s per account/team/range/network (`lib/canvas/ttl-cache.ts`); the browser refetches every 30 s unless paused. Only an auth failure fails the whole response; any other per-service failure becomes `{metrics:{unavailable:true}}` (or `releasesUnavailable`, or an unavailable errors entry) for that service alone, and nothing is substituted for it.
- **Client.** Totals per service are the sum over its applets, averaged into ~60 buckets per window; the stacked charts leave a bucket empty when a service reported nothing in it (a gap is not a zero). Hidden-service choices are kept per account in `localStorage` only (`lib/observability/prefs.ts`, same approach as the canvas layout). Deployment markers are release times inside the drawn range; the Resources tab of an app shows the same markers.
- **Partly verified (2026-10-23).** `since` is unix seconds and the series shape `{end,result:[{values:[[sec,"v"]],applet}]}` (30 s step) is confirmed live; CPU in cores and memory in bytes are consistent with the plan limits (the cpu-bound run reached 99% of a 0.5 vCPU plan). **Network units remain unverified** (magnitudes about 1e2-1e3, probably bytes/s); `unitsVerified:false` stays and the units note is shown next to network values. The dashboard page itself is covered by e2e against the fake Liara; the endpoints it aggregates were verified live, but the page was not separately compared against the Liara console. There is no stored history: charts show only what Liara returns for the window. Marker times are the release `createdAt`, not the moment the new containers took traffic. The "with errors" count comes from a keyword/level heuristic on log text, so it can miss or over-count.

## RTL and Persian design rules

`lang="fa" dir="rtl"`; logical Tailwind utilities only (enforced by `tests/unit/quality/rtl-logical-utilities.test.ts`);
the React Flow container is `dir="ltr"` (its coordinate system) with RTL node content; logs, code, URLs, IPs, env keys and
paths render in `dir="ltr"` monospace blocks with inline fragments in `<bdi>`; Persian digits in prose via `Intl.NumberFormat('fa-IR')`,
Latin digits inside code, logs and timestamps; Jalali dates for display, ISO in evidence; status is never colour-only (icon + text);
all UI strings live in `lib/i18n/fa.ts` and `lib/i18n/ns/*` with a shared glossary (`lib/i18n/glossary.fa.ts`) also used by the
agent prompt (`tests/unit/quality/persian-strings.test.ts` guards this). Vazirmatn is self-hosted.

## Design decisions and rejected alternatives

| Decision | Rejected alternative and why |
|---|---|
| Own thin typed client over `fetch` (`lib/liara`) | Official Node SDK is deprecated and lacks many endpoints used here; an own client gives per-call timeouts, GET-only retry, normalised errors and zod-lenient parsing of unverified shapes |
| MCP not used as architecture | The Liara MCP is unofficial; an in-process, typed, read-only tool set gives enforceable guarantees (transport-level GET-only, scoped target) that a generic tool bus would not |
| Single agent, deterministic backbone | Multi-agent orchestration adds latency, cost and failure modes without improving verifiability; extractors and rules already do the work that must be right, and the LLM is replaceable by rule-only output |
| JSON-file store on a Liara disk, no database | One account's layouts, proposals, incidents and audit are small; a database adds a billed resource and a failure mode for a hackathon-scale product. Cost: single-process only |
| Polling instead of streaming/webhooks | Liara offers neither; SSE endpoints poll Liara server-side and the UI says so |
| Evidence levels by rule, not model probability | Model confidence is not calibrated; rules are explainable and unit-tested |
| Own approval token + typed names instead of a confirm checkbox | Binds an approval to exact target and parameters, single use, short-lived; survives replay and parameter swapping |
| No rollback feature | Liara exposes no rollback endpoint; redeploying an older release is offered only when an image or source exists, and is unverified live |
| `AI SDK v7` with `@ai-sdk/openai-compatible` chat model | The Liara gateway exposes chat completions only (no `/responses`); the provider is env-switchable with an optional fallback endpoint |
