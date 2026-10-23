# Liara API notes (client: `lib/liara`)

Companion to the [README](../README.md) and [architecture](architecture.md). This file is the single place that says
which Liara endpoint each function calls, where the knowledge came from, and whether it has been confirmed live.

**Tags.** **[V]** in the official OpenAPI (`github.com/liara-cloud/openapi`: `spec/paas.yaml`, `dbaas.yaml`, `me.yaml`, `billing.yaml`);
**[CLI]** only seen in the official CLI (`github.com/liara-cloud/cli`, `src/...`), absent from the OpenAPI; **[VAL]** inferred, needs a live call.

**Verification status.** Two live sessions exist. (1) 2026-10-22: a read-only spike against a real but **empty** account (listed under
[Live spike 2026-10-22](#live-spike-2026-10-22-read-only-empty-account)). (2) 2026-10-23: a **team workspace** session in which the product was deployed to
Liara by its own code path and the rule-only troubleshooting loop was run on deliberately broken demo apps (see
[Live 2026-10-23](#live-2026-10-23-team-mode-real-apps-deploy-and-troubleshooting-loop)). In the tables, **VL** = verified live on 2026-10-22 and
**Verified live 2026-10-23** = verified on the second session; **UL** = unverified live (the row is implemented and offline-tested only), and **[VAL]** marks a detail
that is still an assumption. Still unverified: databases (none were created), domains/SSL, resize and plan changes, redeploy-previous, disk resize/delete/backups,
rate limits, team-member permissions, `oom`/`restart` event actions, network metric units, and **everything about the Liara AI gateway** (never called; no AI credentials were used).
Unit tests in `tests/unit/liara` use synthetic fixtures (`tests/fixtures/liara/*.synthetic.json`, written from the specs and CLI source, not recorded);
redacted live recordings are in `tests/fixtures/recorded/` (`spike-2026-10-22.json`, `live-2026-10-23.json`, `team-billing-2026-10-23.json`, `events-2026-10-23.json`,
`build-logs-2026-10-23.json`, `live-runs-2026-10-23.json`; shapes; a few non-personal numeric values such as balances are kept). `tests/live/liara.live.test.ts` and `npm run spike` remain the way to re-check a row (see
[Recording results](#recording-and-committing-redacted-results)).

## Live spike 2026-10-22 (read-only, empty account)

Verified live (2026-10-22, read-only, empty account), and **only** this:

- **Auth.** `Authorization: Bearer <API key>` works on `GET /v1/me`, `GET /v1/billing`, `GET /v1/projects`, `GET /v1/databases`, `GET /v1/networks` (all HTTP 200).
- **Empty lists.** `GET /v1/projects` -> `{projects: []}`, `GET /v1/databases` -> `{databases: []}`, `GET /v1/networks` -> `{networks: []}`.
- **`GET /v1/me`.** `user` has `_id`, `fullname`, `email`, `isTeam`, `isVerified`, `privateNetworkFeature`, `legacyNetworkFeature`, `accountType` (`REAL_PERSON`); `plans` and `databaseVersions` are present.
  Plan objects carry no `region` key. Counts as reported by the spike: 8 app plans, 7 db plans, 9 db engines; every price is finite.
- **`GET /v1/billing`.** `user.balance` (number), `minCreditAmount`, `accountType`.
- **Team mode (verified live 2026-10-23, read-only, `?teamID=<team id>`).** `GET /v1/billing` returns BOTH `user` (the person's own wallet, e.g. 0.6) and `team` (`balance`, `accountType`, `minCreditAmount`, `isManualMinCredit`): the resources and the money belong to the team, so use `team.balance`. `GET /v1/me` returns `user` (`isTeam:false`, `isTeamCreator:true`) AND `team` (`_id`, `isTeam:true`, `teamName`, `teamCreator`, `balance`, `accountType`, `minCreditAmount`, `isManualMinCredit`, `teamMemberRole`, `teamMemberPermissions`, `legacyNetworkFeature`, `privateNetworkFeature`, `legacyObjectStorageFeature`, `invoiceIssuingEnabled`, `joined_at`) plus `databaseVersions, defaultDatabaseVersions, featureFlags, plans`; without `teamID` there is no `team` key. Recorded (anonymised) in `tests/fixtures/recorded/team-billing-2026-10-23.json`. The product picks `team` only when a team id is set AND the response has `team`; a team id with no `team` object means an UNKNOWN balance (billed creates refused with `team_balance_unreadable`), never a fallback to the personal one. `teamMemberPermissions` is carried as data only (shape and meaning not verified).
- **App plan ids seen** (RAM / CPU / disk, hourly toman): `free` (unavailable); `mini-g2` 0.25 GB, unavailable, 381.94; `small-g2` 0.5 GB / 0.5 CPU / 5 GB, 659.72;
  `medium-g2` 1 GB, 1145.83; `standard-base-g2` 2 GB / 1 CPU, 2048.61; `standard-plus-g2` 4 GB / 2 CPU, 3680.55; `pro-g2` 8 GB / 4 CPU, 6388.88;
  `pro-plus-g2` 16 GB / 8 CPU, 11111.11; `pro-max-g2` 32 GB / 16 CPU, 19444.44; `express-g2` 64 GB / 32 CPU, 34166.66.
- **Bundle plans** per app plan: `free | basic | standard | pro`, `displayPrice` monthly (`small-g2`: basic 275000, standard 475000, pro 825000).
- **DB plan ids:** `free` (unavailable), `mini-g2` (unavailable), `small-g2`, `medium-g2`, `standard-base-g2`, `standard-pro-g2` (note: **not** `standard-plus-g2`), `pro-g2`, `pro-plus-g2`, `pro-max-g2`, each with a `supports` engine list.

Still **[VAL]** after the spike:

- Whether a bundle `displayPrice` is **additive** to the hardware price. After this spike it was only an arithmetic observation, **not documented by Liara**: `small-g2` monthly (659.72 x 720 = 474,998) + basic 275,000 ≈ 750,000, the public «Earth» price. The 2026-10-23 first-hour charge (1145.83 = 659.72 + 381.94 + 104.17 for a 1 GB disk) supports additivity; see the [cost table](#cost-table). Still not stated by Liara, so the product shows prices as estimates.
- (State right after the spike. Most of this was verified on 2026-10-23 and is covered in the next section: app detail, logs, metrics, events, releases, build logs, every mutation the deploy and troubleshooting loop needs, and the `teamID` parameter. Still open: database detail, domain records, applets (broken on Liara's side), resize, rate limits, and all AI-gateway behaviour.)

## Live 2026-10-23 (team mode, real apps, deploy and troubleshooting loop)

Verified live 2026-10-23 against a real team account with real apps (team mode, `?teamID=`). The product was deployed to `https://<app>.liara.run` by our own code (`scripts/deploy-self.ts`, no Liara CLI), then deliberately broken demo apps were diagnosed and fixed in rule-only mode (the five troubleshooting runs S1 missing-secret, wrong-port, crash-loop, build-failure and cpu-bound are recorded, redacted, in `tests/fixtures/recorded/live-runs-2026-10-23.json`). No personal data is recorded; redacted shapes are in `tests/fixtures/recorded/live-2026-10-23.json`.

| Item | Result (Verified live 2026-10-23) |
|---|---|
| Disk list by name | `GET /v1/projects/{name}/disks` -> **500** `{"error":"Internal Server Error"}`. By project `_id` (`project._id` from `GET /v1/projects/{name}`) -> **200** `{disks:[{name,size,updatedAt,createdAt,filebrowserUrl}], mounts:[]}`. The disk object has no `_id`. `mounts: []` means the disk exists but no release mounts it. |
| Disk create | `POST /v1/projects/{name}/disks {name,size}` by NAME works. Every other disk route is assumed to take the project `_id` (spec path param `id`) [VAL]. |
| Applets | `GET /v1/projects/{name}/applets` -> 500 from Liara; by `_id` -> 404 "Project not found.". The product shows "unavailable". |
| Project detail keys | `_id, project_id, type, status, readOnlyRootFilesystem, defaultSubdomain, defaultSubdomainExpired, keepDefaultSubdomain, zeroDowntime, scale, envs, planID, bundlePlanID, network, dns, created_at, hourlyPrice, bundleHourlyPrice, isDeployed, reservedDiskSpace`. No `disks` key. |
| Metrics `since` | unix **seconds** works. |
| Metrics series shape | `{end, result:[{values:[[unixSec,"valueString"]], applet}]}`, 30 s step. |
| Metrics summary shape | `{cpuUsage:[{value:[ts,"v"],applet}], memoryUsage:[...], disksUsage:[{name}]}`. |
| Magnitudes | CPU about 0.05 (cores), memory about 8.2e7 (bytes), network rx about 1.2e3 / tx about 3e2 (probably bytes/s). Units remain **unverified**. |
| `g2` plans | need a private network: create one first with `POST /v1/networks {networkName}` -> 201 `{network:{_id}}`; creating an app without one -> 403 code `g2_plan_unavailable`. |
| App names | globally unique: 409 on `hamyar-liara`. |
| Next platform | needs a non-empty `public/` directory, else the build fails with `COPY failed: stat app/public`. |
| Default URL | `https://<app>.liara.run`; the `.iran.liara.run` form returns 404. |
| First-hour charge | a 1 GB disk + small-g2 + basic bundle was charged 1145.83 toman for the first hour = 659.72 + 381.94 + 104.17, so the disk costs about 104.17 toman/hour per GB (**inferred from arithmetic**, not stated by Liara). |
| Restart | `POST /v1/projects/{name}/actions/restart` works; the app was back in about 10-40 s. |
| Env update before first release | `POST /v1/projects/update-envs` works before the first release, with readback. |
| Runtime logs v2 | `GET /v2/projects/{name}/logs` answers `{data:[{metaData:{releaseId}, values:[[nsString, "{type,_entry}"]]}]}` (the `values` entry is a JSON string with `type` and `_entry`). `releaseId` lets the product scope lines to the serving release. |
| Build logs v2 | 20 lines per page; the next page is `?since=<createdAt of the last line>`. npm errors arrive on **STDOUT** (not STDERR) and contain ANSI colour codes, so the product strips ANSI and treats failure from the release state. Fixture: `tests/fixtures/recorded/build-logs-2026-10-23.json`. |
| Releases | `GET /v1/projects/{name}/releases` has a top-level `currentRelease` (the serving release). With a failed newest build the older release keeps serving. |
| Events | `{data:[{status, action, time:"unixSec", release, tag}]}`. Observed live: `create`, `start`, `kill`, `die`, `stop`, `destroy`. Presumed, not yet observed: `oom`, `restart`. |
| App status | the string is `ACTIVE`. |
| Deploy | source `.tar.gz` upload (`POST /v2/projects/{name}/sources`), release creation (`POST /v2/projects/{name}/releases`) and build-log watch to `READY` work with an API key; builds took about 3-4 min; one build ended `TIMEDOUT` at the packaging step and the retry passed. Release body must carry `disks:[{name:'data',mountTo:'data'}]` to mount the disk. `liara.json`'s `healthCheck` field is not sent by our release body (unverified). |
| Disk mount | container cwd is `/app`; `DATA_DIR=./data` resolves to `/app/data`, which is on the mounted disk; data survived a restart. The Next platform filesystem is writable but temporary outside disks. |
| Health and headers | `/api/health` 200; cookie `Secure; HttpOnly; SameSite`; CSP, HSTS and frame headers present; SSE not buffered by the ingress (first byte 35 ms, 15 s heartbeat). |
| Env update (executor path) | `set_env` via `update-envs` + restart worked in the `missing-secret` run (`env_keys_applied` passed). Full-replace semantics and masked values of `encrypted` variables are not separately verified [VAL]. |
| Network / app / source upload | `POST /v1/networks {networkName}` 201; app create with a g2 plan works once a network is given; source upload accepted. |

Consequence for the product: all disk reads and writes except create go through the project `_id` (`lib/liara/disks.ts`), and `scripts/deploy-self.ts --release-only` refuses to release when the disk named `data` cannot be looked up or is missing (override: `--no-disk`), then re-reads the disks and prints PASS/FAIL "disk mounted".

### Liara quirks we hit

1. `g2` app plans (`small-g2` and up) **require a private network**: app create without one is 403 `g2_plan_unavailable`; create it with `POST /v1/networks {networkName}` (201).
2. **App names are globally unique** across all of Liara (409 on a taken name).
3. `GET /v1/projects/{name}/applets` returns **HTTP 500** from Liara for our apps (by `_id`: 404 "Project not found."). The product degrades and discloses it.
4. `GET /v1/projects/{name}/disks` answers 500 by **name**; use the project `_id`. Disk create works by name. The disk object has no `_id`.
5. The Next platform needs a **non-empty `public/`** directory (`COPY failed: stat app/public` otherwise).
6. Default URL is `https://<app>.liara.run`; the `.iran.liara.run` form returns 404.
7. In team mode, `/v1/billing?teamID=` returns **both** `user` and `team`; the money is `team.balance`, the personal wallet is separate.
8. npm errors in build logs arrive on **STDOUT** with ANSI codes; build logs are paged 20 lines at a time (`?since=<createdAt of last line>`).
9. A build can end `TIMEDOUT` at the packaging step; a retry passed.
10. Liara's Next platform filesystem is writable but **temporary** outside a mounted disk; the disk needs `disks:[{name,mountTo}]` in the release body.
11. Metrics return the CPU in cores and memory in bytes (consistent with plan limits), but network values have an unverified unit.
12. `GET /v1/projects/{name}/releases` has a top-level `currentRelease`; use it instead of guessing the serving release from the newest one.

### Cost table

Observed on 2026-10-23 in the team workspace (toman). Hourly prices come from `GET /v1/me` plan data; the disk price is **inferred** from the first-hour charge (1145.83 = 659.72 + 381.94 + 104.17), not stated by Liara.

| Item | Toman / hour | Note |
|---|---|---|
| `small-g2` app plan (0.5 GB, 0.5 CPU) | 659.72 | read from plan catalogue; billed |
| `basic` bundle on `small-g2` | 381.94 | monthly `displayPrice` 275,000 / 720; billing is additive (confirmed by the first-hour charge) |
| App total (small-g2 + basic) | 1041.66 | about 25,000 per day, about 750,000 per month |
| 1 GB disk | about 104.17 | inferred |
| First hour of app + 1 GB disk | 1145.83 | observed charge |
| Whole live session (all apps, deploys, scenarios) | about 6,875 total | observed spend |

## Conventions

- Base `https://api.liara.ir`, `Authorization: Bearer <key>` (VL on the five reads above; Verified live 2026-10-23 on every call the product made, including mutations), query `teamID=` always sent (empty = personal account) [CLI `base.ts`]; Verified live 2026-10-23: with a team ID the team's resources and wallet are used. The base can be overridden by `LIARA_API_BASE_URL` for e2e only; it is ignored in production.
- Errors are normalised to `LiaraError {status, code?, message, kind, body?}`; kinds: `auth, forbidden, not_found, conflict, rate_limited, payment, validation, server, timeout, network, unknown`. Liara bodies look like `{statusCode, message, data:{code}}`; `code` is `data.code`, or `message` when it is a snake_case token (`frozen_project`).
- Only GETs are retried (network / timeout / 5xx / 429, backoff + `Retry-After`, 2 retries). Mutations are never retried. Concurrency is capped at 3 requests. The token never appears in error text, bodies or URLs (unit-tested in `tests/unit/liara/core.test.ts`).
- Zod schemas are lenient: unknown keys pass through, scalar fields of the wrong type become `undefined`, enums are strings.
- The copilot pipeline receives a wrapper (`lib/agent/readonly-liara.ts`) that rejects every non-GET request.

## Endpoint matrix

Status column: **UL** = Unverified live; **VL** = Verified live (2026-10-22, read-only, empty account), see [Live spike 2026-10-22](#live-spike-2026-10-22-read-only-empty-account); **Verified live 2026-10-23** = confirmed on the team-workspace session. A row that is partly verified says which part.

### Apps, releases, deploy

| Function | Call | Tag | Status |
|---|---|---|---|
| `listApps` / `getApp` | `GET /v1/projects`, `GET /v1/projects/{name}` (`network{_id,name}` is [CLI]) | [V] | list call: VL; item and detail shape Verified live 2026-10-23 (keys: `_id, project_id, type, status, readOnlyRootFilesystem, defaultSubdomain, defaultSubdomainExpired, keepDefaultSubdomain, zeroDowntime, scale, envs, planID, bundlePlanID, network, dns, created_at, hourlyPrice, bundleHourlyPrice, isDeployed, reservedDiskSpace`; `status` = `ACTIVE`) |
| `createApp` | `POST /v1/projects {name,planID,platform,bundlePlanID,network,readOnlyRootFilesystem}`, then refetch (empty 200) | [V] + `bundlePlanID` [CLI] | Verified live 2026-10-23 (with `network`; without one a g2 plan is 403) |
| `deleteApp` | `DELETE /v1/projects/{name}` | [V] | Verified live 2026-10-23 (cleanup of demo apps) |
| `restartApp` | `POST /v1/projects/{name}/actions/restart` | [V] | Verified live 2026-10-23 (back in about 10-40 s) |
| `scaleApp` / `startApp` / `stopApp` | `POST /v1/projects/{name}/actions/scale {scale:0\|1}` | [V] | UL |
| `resizeApp` | `POST /v1/projects/{name}/resize {planID}`; cost and downtime | [V]; [VAL] | UL |
| `updateAppPort` | `POST /v1/projects/update-port {project,port}` | [CLI] | UL (the `wrong-port` run diagnosed the mismatch and proposed `update_port`; the proposal was not executed live) |
| `setAppToggle` | `POST /v1/projects/{name}/{zero-downtime\|default-subdomain\|fixed-ip\|read-only}/{enable\|disable}`; `{name}` vs id | [V]; [VAL] | UL |
| `listApplets` | `GET /v1/projects/{name}/applets`. **Verified live 2026-10-23: answers 500 (from Liara itself); by `_id` 404 "Project not found."** The product degrades to `unavailable` (overview section, evidence source `applets` failed -> explicit unknown, `GET /api/apps/{name}/applets` -> 502); an unread list is never reported as "no applets" | [V] | Verified live 2026-10-23: FAILS (500) |
| `getAppEvents` | `GET /v1/projects/{name}/events?search&start&end`; line format | [V] | Verified live 2026-10-23: `data[]` `{status, action, time:"unixSec", release, tag}`; actions observed live: `create`, `start`, `kill`, `die`, `stop`, `destroy`; presumed (Docker names), not yet observed: `oom`, `restart` (UL). Old Loki-style `values` rows kept as fallback. The `crash-loop` diagnosis counts `die+start x5 within 60 s` from these. Fixture: `tests/fixtures/recorded/events-2026-10-23.json` |
| `listReleases` | `GET /v1/projects/{name}/releases?page&count` (top-level `currentRelease`) | [V] | Verified live 2026-10-23 |
| `getRelease` | `GET /v1/releases/{id}` (`state`, `failReason`, `queue`) | [CLI] | Verified live 2026-10-23 |
| `cancelRelease` | `POST /v2/releases/{id}/cancel` | [CLI] | UL |
| `getBuildLogs` | `GET /v2/releases/{id}/build-logs?since=<createdAt>` returning `{release, buildOutput[]}`; 20 lines per page, next page `?since=<createdAt of last line>`; npm errors on STDOUT with ANSI codes | [CLI] | Verified live 2026-10-23 |
| `uploadSource` | `POST /v2/projects/{name}/sources` multipart `file` (.tar.gz, <= 256 MiB) returning `{sourceID}` | [V] + [CLI] | Verified live 2026-10-23 |
| `createRelease` | `POST /v2/projects/{name}/releases {sourceID\|image, port, type, build, cron, args, disks, envs, ...}` returning `{releaseID}`; full body from CLI `deploy.ts`; Verified live 2026-10-23 with `{sourceID, port, type:"next", disks:[{name,mountTo}], platformConfig}`; `healthCheck` is not sent (UL); `image` releases and `redeploy_previous`: UL | [V] partial + [CLI] | Verified live 2026-10-23 (source path) |
| `deploySource`, `watchRelease` | compose the two above; `watchRelease` polls `getRelease` (~3 s while queued) then `getBuildLogs` (~1 s) | [CLI `services/build-logs.ts`] | Verified live 2026-10-23 (watch to `READY`, a `FAILED` build named by `build-failure`, one `TIMEDOUT`) |

Terminal release states used: `READY`, `FAILED`, `CANCELED`, `TIMEDOUT`, `UNHEALTHY`; `DEPLOYING` is non-terminal [CLI].
A `STDERR` build line counts as failure, as in the CLI. Deploy error codes handled: 400 `frozen_project`, 428 `max_deployment_count_in_day`,
428 `germany_builder_not_allowed`, 413 source too large [CLI `deploy.ts`].

### Logs, metrics, environment variables

| Function | Call | Tag | Status |
|---|---|---|---|
| `getRuntimeLogs` / `tailRuntimeLogs` | `GET /v2/projects/{name}/logs?start=<unix s>&direction=forward&last_lines&releaseId` | [CLI `app/logs.ts`] | Verified live 2026-10-23 (shape below) |
| (fallback, same functions) | `GET /v1/projects/{name}/logs?since=` returning `[{type,datetime,message}]`; unit of `since` | [V]; [VAL] | UL |
| `getAppMetricsSummary` | `GET /v1/projects/{name}/metrics/summary`. **Verified live 2026-10-23:** `{cpuUsage:[{value:[ts,"v"],applet}], memoryUsage:[...same], disksUsage:[{name}]}`; CPU in cores and memory in bytes are consistent with plan limits; network unit unverified [VAL] (see [Live 2026-10-23](#live-2026-10-23-team-mode-real-apps-deploy-and-troubleshooting-loop)) | [V] | Verified live 2026-10-23 (shape; cpu/memory units consistent) |
| `getAppMetricSeries` | `GET /v1/projects/{name}/metrics/{cpu\|memory\|network-receive\|network-transmit}?since=`. **Verified live 2026-10-23: `since` = unix seconds works; response `{end, result:[{values:[[unixSec,"valueString"]], applet}]}`, 30 s step** | [V] | Verified live 2026-10-23 |
| `getEnvs` | read from `getApp().envs` | [V] | Verified live 2026-10-23 |
| `updateEnvs` | `POST /v1/projects/update-envs {project, variables:[{key,value}]}`; replaces ALL variables and restarts the app | [V]; full-replace semantics and masked `encrypted` values [VAL] | Verified live 2026-10-23 (works, also before the first release, with readback); full-replace and masked values: UL |
| `applyEnvOps` | helper: read, `mergeEnvs`, `updateEnvs`, read back; returns key lists only | helper | Verified live 2026-10-23 (`missing-secret` fix) |

v2 log shape: `{data:[{metaData:{releaseId}, values:[[ns, '{"_entry":"...","type":"stdout|stderr"}']]}]}` (groups are not globally
sorted; the parser sorts by BigInt ns). v2 falls back to v1 when v2 answers 404/405/501 and v1 works; the choice is cached per client.
`tailRuntimeLogs` polls every 1.5 s from the last seen second and de-duplicates on `tsNs|stream|message`.

### Domains, disks, networks

| Function | Call | Tag | Status |
|---|---|---|---|
| `listDomains` / `addDomain` | `GET /v1/domains?project=`, `POST /v1/domains {name,project,type:"PROJECT"}` | [V] | UL |
| `checkDomain` | `GET /v1/domains/{id}/check` (`CNameRecord`, `verificationCode`, `certificatesStatus`); record values | [V]; [VAL] | UL |
| `provisionSsl` | `POST /v1/domains/provision-ssl-certs {domain}`; name vs id | [V]; [VAL] | UL |
| `setDomainRedirect` | `POST /v1/domains/{id}/set-redirect {redirectStatus, redirectTo}` | [V] | UL |
| `disableSsl` | `POST /v1/domains/{id}/ssl/disable` | [V] | UL |
| `removeDomain` | `DELETE /v1/domains/{id}` | [V] | UL |
| `listDisks` / `createDisk` | `GET /v1/projects/{_id}/disks` (**by project `_id`; by name it answers 500, Verified live 2026-10-23**) -> `{disks:[{name,size,updatedAt,createdAt,filebrowserUrl}], mounts:[]}` (`mounts: []` = the disk exists but no release mounts it). `POST /v1/projects/{name}/disks {name,size}` works by NAME (**Verified live 2026-10-23**). The client resolves the `_id` with `getApp` (cached per client for 10 s) | [V] | Verified live 2026-10-23 |
| `resizeDisk` / `deleteDisk` | `POST /v1/projects/{_id}/disks/{name}/resize {size}`, `DELETE /v1/projects/{_id}/disks/{name}`: project `_id` assumed like the list route (the spec names the path param `id`) [VAL] | [V] | UL |
| `listDiskBackups` / `createDiskBackup` | `GET`, `POST /v1/projects/{_id}/disks/{name}/backups` (project `_id`, assumed) [VAL] | [V] | UL |
| `getDiskBackupLink` | `POST /v1/projects/{_id}/disks/{name}/backups/{backup}/download` returning `{link}` (project `_id`, assumed) [VAL] | [V] | UL |
| `listNetworks` | `GET /v1/networks` returning `{networks:[{_id,name,createdAt}]}` | [CLI] | list call: VL; Verified live 2026-10-23 with a real network (apps carry `network{_id,name}`) |
| `createNetwork` | `POST /v1/networks {networkName}` returning 201 `{network:{_id}}` | [CLI] | Verified live 2026-10-23 |

### Databases (`spec/dbaas.yaml`)

| Function | Call | Tag | Status |
|---|---|---|---|
| `listDatabases` | `GET /v1/databases` (`_id`, `bundlePlanID` are [CLI]) | [V] | list call: VL (200, empty `{databases: []}`); item shape: UL |
| `getDatabase` | `GET /v1/databases/{id}`; `root_password` stripped at parse time | [V] | UL |
| `getDatabaseCredentials` | same call, returns the clear-text password; explicit opt-in (reveal route) | [V] | UL |
| `createDatabase` | `POST /v1/databases {hostname,type,version,planID,bundlePlanID,publicNetwork,network,options}` returning `{databaseID}` | [V] + [CLI] | UL |
| `deleteDatabase` | `DELETE /v1/databases/{id}` | [V] | UL |
| `scaleDatabase` | `POST /v1/databases/{id}/actions/scale {scale}` | [V] | UL |
| `resizeDatabase` | `POST /v1/databases/{id}/resize {planID,disk}`; `disk` | [V]; [VAL] | UL |
| `updateDatabaseSettings` | `PATCH /v1/databases/{id}/settings {type,options}` | [V] | UL |
| `setDatabasePublicNetwork` | `PATCH /v1/databases/{id}/public-network/{enable\|disable}` | [V] | UL |
| `setDatabaseControlPanel` | `POST /v1/databases/{id}/control-panel/{enable\|disable}` | [V] | UL |
| `listDatabaseBackups` / `createDatabaseBackup` | `GET`, `POST /v1/databases/{id}/backups` | [V] | UL |
| `getDatabaseBackupLink` | `POST /v1/databases/{id}/backups/{name}/download` returning `{link}` | [V] | UL |
| `getDatabaseMetricsSummary` / `getDatabaseMetricSeries` | `/v1/databases/{id}/metrics/summary`, `/metrics/{cpu\|memory\|network-*}?since=`; units | [V]; [VAL] | UL |
| `getDatabaseEvents` | `GET /v1/databases/{hostname}/events` | [V] | UL |

Which id goes in `/v1/databases/{id}`: the CLI uses `_id` from the list; `databaseRef()` prefers `_id`, then `id`, then `DBId` [VAL].
`redactDatabase()` strips password/secret/token/api-key properties from any raw database object. Status seen in specs: `RUNNING`; the rest is [VAL].

### Account, plans, billing

| Function | Call | Tag | Status |
|---|---|---|---|
| `getMe` | `GET /v1/me` (**Verified live (2026-10-23): team mode returns user+team; use team.balance**; user, team, `plans{projects, projectBundlePlans, databases, databaseBundlePlans}`, `databaseVersions`, network feature flags) | [V] | VL for `user` (`_id`, `fullname`, `email`, `isTeam`, `isVerified`, `privateNetworkFeature`, `legacyNetworkFeature`, `accountType`), `plans`, `databaseVersions`; `team` object (team accounts) and `teamID`: Verified live 2026-10-23 (see the team-mode paragraph above and `team-billing-2026-10-23.json`) |
| `getBilling` | `GET /v1/billing` (balance). **Verified live (2026-10-23): team mode returns user+team; use team.balance.** `normalizeBilling` / `getAccountBilling` / `normalizeAccount` (lib/liara/account.ts) pick the source (`source: "team" \| "user"`) | [V] | VL (`user.balance` number, `minCreditAmount`, `accountType`; team mode: `team.balance`, `team.minCreditAmount`, `team.teamName`, `team.teamMemberRole`) |
| `listAppPlans` / `listDbPlans` / `listDbVersions` | normalisers over `getMe` (no extra call). Plan fields `available, region, RAM.amount, CPU.amount, volume, price` (hourly), `supports[]`, bundle `displayPrice` (monthly), `maxLogsRetention` come from the CLI. Defaults: available, `region: iran`, ids `free` or containing `g2`; `pricePerMonth = pricePerHour * 720` | [CLI]; [VAL] | plan ids, RAM/CPU/disk, hourly prices, bundle ids and `displayPrice` values: VL; additivity of the bundle price is supported by the 2026-10-23 first-hour charge (Verified live 2026-10-23, inferred from arithmetic; not stated by Liara) |

### Liara AI gateway (used by the copilot)

| Use | Call | Tag | Status |
|---|---|---|---|
| Chat completions with tools and structured output | `POST {LIARA_AI_BASE_URL}/chat/completions` through `@ai-sdk/openai-compatible` (`lib/agent/provider.ts`); chat completions only, no `/responses` | docs.liara.ir | UL |
| Model list (spike / live test) | `GET {LIARA_AI_BASE_URL}/models` | docs.liara.ir | UL |

Base URL form (`https://ai.liara.ir/api/<workspaceId>/v1`, docs show a second form), streaming, `tools`, `json_schema`, in-plan model ids and
the 429 body are checklist item 5.

### Source archives (`createSourceArchive`)

zip (fflate) or file list, then tar (tar-stream), then gzip (zlib level 9). Rejects `..`, absolute and drive paths, NUL, symlinks (zip unix
attributes read from the central directory; Zip64 refused), more than 256 MiB compressed, more than 1 GiB uncompressed (declared sizes checked
before inflate) and more than 50,000 files. Ignore rules: CLI defaults, then root `.liaraignore`, else `.dockerignore`, else `.gitignore` [CLI].
The matcher is a gitignore subset (no `[a-z]` classes, root file only); nested ignore files are not read.

## Limitations

- No rollback endpoint. Redeploying an older release by `imageName`/`sourceID` (`redeploy_previous`) is untested (item 10).
- No DB restore, password reset, rename or network change; no webhooks; no documented rate limits or key scopes (not probed live); no streaming logs (the product polls).
- Metrics are Prometheus-style `[ts, "value"]` pairs; `since` is unix seconds (Verified live 2026-10-23); CPU cores and memory bytes are consistent with plan limits, network unit and the maximum `since` window are unknown (item 3).
- `update-envs` may return masked values for `encrypted` variables; if so, read-merge-write would overwrite them (item 4).
- Default sub-domain suffix `liara.run` (`lib/canvas/urls.ts`): Verified live 2026-10-23 (`https://<app>.liara.run`; `.iran.liara.run` is 404).
- `GET /v1/projects/{name}/applets` is broken on Liara's side (500), so instance state is unavailable and verification discloses it (`applets_available` = unknown).
- CLI endpoints can change without notice; lenient schemas and v1 fallbacks reduce, not remove, that risk.

## Live-validation checklist

Run order: `npm run spike` (read-only) first, then `npm run test:live` with a throwaway app. Missing credentials make both skip, not fail.
"Fallback" is what the product does if the item fails (from `CHANGES` in `scripts/lib/spike.ts`).

| # | Item | `spike` row | `tests/live` test | Fallback if it fails |
|---|---|---|---|---|
| 1 | Runtime logs v2 shape, v1 fallback | 1 | `1. runtime logs` | v2 failing falls back to v1 automatically; both failing marks logs unavailable and the copilot loses log evidence |
| 2 | Release detail + build-logs accept an API key | 2 | `2. release detail + build-logs` | Releases tab shows no build output; build-failure diagnosis degrades to state + `failReason` |
| 3 | Metrics `since` unit and shape | 3 | `3. metrics` | Adjust `lib/liara/metrics.ts` and collectors; until then charts say unavailable and OOM/CPU findings lose numbers |
| 4 | `update-envs` full-replace and masked encrypted values | skipped (mutating) | `4. update-envs` (needs `ALLOW_BILLED_LIVE_TESTS=1`) | Change the safe-merge helper; keep the Variables tab disabled until verified |
| 5 | AI gateway: base URL, streaming, tools, `json_schema`, 429 shape | 5 with `--ai` | `5a`, `5b`, `5c` (5b/5c billed, tiny), `5d` is a `todo` | Switch URL form, use the single structured-call path (no tools), or change `LLM_MODEL`; rule-only mode always works |
| 6 | `/v1/me` plan and price shapes | 6 | `6. GET /v1/me` | Fix `lib/liara/account.ts` before enabling any billed flow |
| 7 | Database list and detail ids/shapes | 7 | `7. databases` | Fix `lib/liara/databases.ts` before enabling DB features and env-to-DB edges |
| 8 | Networks and `network` on apps | 8 | `8. networks` | Canvas falls back to one «بدون شبکه» group |
| 9 | Domain add/check record values | 9 (read-only part) | `9.` (read) and `9b.` (adds then removes `LIARA_TEST_DOMAIN`) | Domain doctor shows generic DNS guidance |
| 10 | Redeploy an older release by image/`sourceID` | skipped (mutating) | `10. redeploy an older release` | `redeploy_previous` stays hidden/refused |
| 11 | Status enums (app, DB, applet, domain, release) | 11 | `11. status enums` | Unknown values display as raw strings with a neutral badge; record real values in `lib/liara/schemas.ts` |
| 12 | Rate-limit behaviour | 12 with `--rate-probe <n>` | `12. rate-limit` | Keep concurrency 3 and 429 backoff on reads only |
| 13 | Create-app initial `scale` / `isDeployed` | skipped (mutating, billed) | `13. create-app` (only if `LIARA_TEST_APP` does not exist) | Create flow cannot show an accurate initial state |

Spike 2026-10-22 outcome (empty account): item 6 **pass**, item 8 **pass** (0 networks, so the `network` field on apps is untested); items 1, 2, 3, 7, 9, 11 **inconclusive** (nothing to read from);
items 4, 10, 13 skipped (mutating), 5 and 12 not requested. Every inconclusive/skipped item remains Unverified live.

Live 2026-10-23 outcome (team workspace, real apps): item 1 **pass** (v2 shape, `releaseId` per group); item 2 **pass** (release detail and build logs v2 with an API key); item 3 **pass** for `since` (unix seconds) and shapes, units partly (CPU cores, memory bytes; network unit open); item 4 **partly** (update-envs works and reads back, full-replace and masked encrypted values not separately checked); item 8 **pass** (network create, apps carry `network`); item 11 **partly** (app `ACTIVE`, release `READY`/`FAILED`/`TIMEDOUT`, events `create/start/kill/die/stop/destroy`; DB, domain and applet enums not seen); item 13 not asserted (a billed create worked, but initial `scale`/`isDeployed` were not recorded as a check). Items 5 (AI gateway), 7 (no database was created), 9 (no domain), 10 (redeploy previous) and 12 (rate limit) were **not** exercised and remain Unverified live; item 6 was re-read in team mode and passes. Nothing about the AI gateway has been verified.

Commands (credentials come from the process environment; `.env` is not read automatically by the scripts):

```bash
# read-only; writes tests/fixtures/recorded/spike-<date>.json (redacted shapes)
npx tsx --env-file=.env scripts/spike.ts --app <name> --rate-probe 10
# add AI checks (needs LIARA_AI_BASE_URL, LIARA_AI_API_KEY, LLM_MODEL)
npx tsx --env-file=.env scripts/spike.ts --app <name> --ai
# live tests (loads .env/.env.local itself); mutating ones need LIARA_TEST_APP + ALLOW_BILLED_LIVE_TESTS=1
npm run test:live
```

The live suite reads `LIARA_AI_MODEL` (default `openai/gpt-4.1-mini`) for item 5 and `LIARA_TEST_DOMAIN` for `9b`; these are not in `.env.example`.

## Recording and committing redacted results

1. Run the spike. `scripts/lib/spike-cli.ts` redacts the report (keys and shapes, never values) and **refuses to write it** if any known secret appears in it. Output: `tests/fixtures/recorded/spike-YYYY-MM-DD.json`.
2. Read the file once before committing: it should contain endpoint paths, status codes, key lists, enum values and counts only.
3. Commit it. `tests/fixtures/recorded/` is the only place for recorded material; raw responses (`tests/fixtures/raw/`) are git-ignored and must stay local.
4. For each item that passed, change its **Status** cell(s) here from "Unverified live" to "Verified live (spike-YYYY-MM-DD)" and remove the matching [VAL] note. For failures, record the real shape and apply the fallback from the table.
5. Live-test output is printed as keys-only summaries (`[live] ...`); paste the relevant shape into this file when an item is resolved (for example the 429 body for 5d).

## Manual steps that cannot be automated

- Creating the Liara API key (and, for the AI gateway, a workspace and key) in the Liara console; keys are shown once.
- Buying/activating an AI plan that includes the chosen model, and keeping account balance for billed resources.
- DNS records for custom domains at the registrar (for `.ir` domains also at nic.ir/IRNIC); the product shows the exact records but never edits DNS.
- SSL issuance after DNS has propagated (the product can request it only once `check` reports the records).
- Creating the private network (g2 plans need one) and, unless `scripts/deploy-self.ts` does it, the disk named `data` for this product's own deployment (see README, "Deploy to Liara") and setting its environment variables.
