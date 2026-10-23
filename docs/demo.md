# Demo guide

How to reproduce the demo, what each scenario showed live, and a ~5-minute Persian video script. Read
[README, "What is verified live vs. offline"](../README.md#what-is-verified-live-vs-offline) first.

**What is real.** On 2026-10-23, on real Liara in a team workspace, this product was deployed to `https://<app>.liara.run` by its own code path
and five deliberately broken demo apps (`scripts/seed-demo.ts` scenarios) were diagnosed and, for `missing-secret`, fixed and verified, all in
**rule-only mode**. **What is not real:** the AI copilot. No AI credentials were used, the Liara AI gateway was never called, and every live run showed the
banner «توضیح هوشمند در دسترس نیست؛ این شواهد پیدا شد.» (`llm_unavailable`). Never present model prose as live-tested.

## Preconditions

- A Liara account (team workspace works; enter the team ID when connecting) with a **positive balance**. Apps are billed: `small-g2` + `basic` bundle is about 1042 toman/hour per app, a 1 GB disk about 104 toman/hour.
- A **private network** in that account. `small-g2` and other g2 plans cannot be created without one (403 `g2_plan_unavailable`).
- **Unique app names** (names are global across Liara; 409 otherwise). The examples use `broken-shop` for the headline scenario and `broken-shop-2` for the second one.
- An API key (and team ID for team accounts), and the product running locally (`npm run dev`) or deployed ([README, Deploy to Liara](../README.md#deploy-to-liara)).
- `.env` with `LIARA_API_TOKEN`, optional `LIARA_TEAM_ID`. The scripts read the **process** environment only, so load the file explicitly with `npx tsx --env-file=.env ...`. `LIARA_AI_*` is optional and **unverified**; leave it unset for the demo described here.
- Node 22 and `npm install` done.

## Cost warning and guards

- `seed:demo` and `reset:demo` are **dry runs by default**: they print the steps and change nothing. `--yes` performs them.
- Creating the app is billed. It needs `--create --plan <planId> --network <name>` **and** `ALLOW_BILLED_LIVE_TESTS=1`; otherwise the command refuses (exit code 2). Create the app by hand in the console if you prefer.
- Each deploy and each env change restarts the app and counts toward Liara's daily deployment cap (code 428 `max_deployment_count_in_day`). Builds take about 3-4 minutes and one live build ended `TIMEDOUT` at the packaging step (the retry passed): budget time.
- Delete the demo apps when finished ([cleanup](#cleanup)); nothing deletes them automatically.
- Live tests (`npm run test:live`) never create billed resources unless `ALLOW_BILLED_LIVE_TESTS=1` and `LIARA_TEST_APP` are set.

## Reproduce

```bash
# 0. Read-only sanity check of the account (see docs/liara-api.md)
npx tsx --env-file=.env scripts/spike.ts

# 1. Dry run: prints plan, archive size, steps; no changes
npx tsx --env-file=.env scripts/seed-demo.ts --scenario healthy --app broken-shop

# 2. Create (billed) and deploy the healthy baseline into your private network
ALLOW_BILLED_LIVE_TESTS=1 npx tsx --env-file=.env scripts/seed-demo.ts \
  --scenario healthy --app broken-shop --create --plan small-g2 --network <network-name> --yes

# 3. Break it: deploy the headline scenario (unsets SESSION_SECRET, site returns 500)
npx tsx --env-file=.env scripts/seed-demo.ts --scenario missing-secret --app broken-shop --yes
```

Then open the product, connect with the key (and team ID), click the `broken-shop` node, and use the **همیار** tab or the «بررسی با همیار» button.
`npm run seed:demo -- <flags>` works the same once the variables are exported in your shell. Exit codes: 0 ok, 1 usage, 2 refused by a guard, 3 Liara error.

## Scenarios

IDs match `demo-app/<id>/` and `demo-app/scenarios.json`. The **Run live (2026-10-23, rule-only)** column states only what was observed; the thresholds behind the CPU finding are heuristic (calibrated on one 0.5 vCPU run). Evidence record of the five runs (redacted): see `tests/fixtures/recorded/live-runs-2026-10-23.json`.
Tier and approval rules are in [architecture](architecture.md#agent-design).

| ID | Symptom | Live result (2026-10-23) | Proposed fix | Verification |
|---|---|---|---|---|
| `healthy` (1.0.0) | None; pages load, `/health` 200 | Baseline and `reset:demo` target | none | Baseline |
| `missing-secret` (2.0.0) | HTTP 500 on every page, app "running", `/health` 200, stack trace in stderr | Diagnosis in about 6 s, strong evidence (`SESSION_SECRET is not set`). Approve -> execute -> `verified` in about 44 s with 7 checks | `set_env SESSION_SECRET` (new random value generated server-side), tier 1, then restart | `env_keys_applied`, `applets_available` (**unknown**), `app_running` (via app detail), `restart_observed` (via events), `probe_2xx` (settling window), `behavior_changed` (5xx before, 2xx now), `error_signature_absent` (lines of the NEW release only) |
| `wrong-port` (2.1.0) | Site unreachable; log only says "listening on port 8080" | Port mismatch diagnosed as strong; `update_port` proposed (not executed live) | `update_port` to 8080 | Liara exposes no port setting, so `port_readback` makes this `not_verified` unless the release reports 8080 |
| `crash-loop` (2.2.0) | App flaps between running and restarting | `TypeError` with file:line from logs plus `die+start x5 within 60s` from events; **no auto-fix proposed** | none (explains; must not restart blindly) | n/a |
| `build-failure` (2.5.0) | Newest release FAILED during build | Newest release failed while an older one still serves; names `express@^99.0.0` | none via API; fix `package.json` and redeploy | n/a |
| `cpu-bound` (2.3.0) | `/report` takes about 3 s; other pages slow | CPU saturation strong (99% of the plan), no restart proposed, RAM not blamed | advice only (code change or larger CPU plan; `resize` is tier 2, costed, typed name) | n/a |
| `memory-leak` (2.4.0) | Restarts after `/leak`; OOM-style kills | **Not run live** (`oom` events not yet observed) | `resize` to more RAM as a stopgap (tier 2) | offline-tested only |
| `db-unreachable` (2.6.0) | HTTP 500; `getaddrinfo ENOTFOUND` in logs | **Not run live** (no database created) | `set_env DB_HOST` to the DB's private hostname (`wire_db`) | offline-tested only |

The copilot may legitimately answer "insufficient evidence" when logs are unavailable; that is correct behaviour, not a demo failure.

## Pre-demo checklist

1. **Balance**: team wallet covers several hours of every app you keep running (read it on the canvas balance chip; for the team it is `team.balance`, not the personal wallet).
2. **Network exists** in the account (the canvas shows it as a frame).
3. **Apps exist**: the deployed product instance (optional but impressive), `broken-shop` (broken), `broken-shop-2` (second scenario). Check each node is on the canvas.
4. **Stable 500 before recording**: `curl -s -o /dev/null -w '%{http_code}\n' https://broken-shop.liara.run/` several times over a minute; it must say 500 every time, with `/health` at 200. If the app just restarted, wait for the release to be READY.
5. **Dry-run the whole path once** (a full take costs a restart and a deployment-cap slot). A fake-Liara rehearsal is free: `npm run e2e` drives the same UI (label it as a simulation if you show it).
6. Clear old proposals: they expire after 10 minutes; incidents and audit entries from earlier takes stay in `DATA_DIR/` and appear in `/incidents` and `/activity`.
7. **Rotate the Liara API key before recording** (it appears in your clipboard and screen history) and again after publishing; never show the `.env` file or terminal environment.
8. Set the browser to 1280x800, light theme, zoom 110%.

## Reset between takes

```bash
# re-apply the broken state exactly (redeploy + env state); wait for READY
npx tsx --env-file=.env scripts/reset-demo.ts --scenario missing-secret --app broken-shop --yes
# second scenario (seed `healthy` into broken-shop-2 first with --create, so an older good release keeps serving)
npx tsx --env-file=.env scripts/seed-demo.ts --scenario build-failure --app broken-shop-2 --yes
# or restore the good version
npx tsx --env-file=.env scripts/reset-demo.ts --scenario healthy --app broken-shop --yes
```

The script watches the release. Reload the product, clear the copilot thread, then re-run the stable-500 check above.

## Video script (about 5 minutes, Persian narration)

Timings are cumulative targets. Keep the cursor slow. Execution and verification take real seconds on camera (about 6 s diagnosis, about 44 s fix and verification): do not cut them out, narrate over them.

| Time | Screen | Narration (Persian) |
|---|---|---|
| 0:00-0:25 | Connect page: paste key **and team ID**, canvas appears | «همیار لیارا یک کنسول فارسی برای لیاراست. با کلید API و شناسهٔ تیم وصل می‌شوم؛ کلید فقط در یک کوکی رمزگذاری‌شده روی سرور می‌ماند و منابع و موجودی همان تیم نمایش داده می‌شود.» |
| 0:25-0:55 | Canvas: the deployed Hamyar instance, the private network frame, `broken-shop` red, balance chip | «اینجا برنامه‌ها و شبکهٔ خصوصی را یک‌جا می‌بینید. خود همیار هم با همین کد روی لیارا مستقر شده است. سلامت هر سرویس با بررسی HTTP زنده است. `broken-shop` قرمز است.» |
| 0:55-1:15 | `/observability` («پایش»): CPU/RAM charts, deployment markers, recent errors panel | «پنل پایش، مصرف پردازنده و حافظهٔ همهٔ سرویس‌ها و خطاهای اخیر را کنار هم نشان می‌دهد. این بخش فقط می‌خواند و هر ۳۰ ثانیه تازه می‌شود.» |
| 1:15-1:30 | Open `broken-shop.liara.run` in a tab: HTTP 500 | «سایت خطای ۵۰۰ می‌دهد، اما لیارا آن را در حال اجرا نشان می‌دهد.» |
| 1:30-2:15 | Click «بررسی با همیار»; timeline steps; the answer appears after about 6 s; finding card with observed / inferred / unknown and the evidence level chip | «همیار شواهد را می‌خواند و در حدود شش ثانیه جواب می‌دهد. پاسخ سه بخش برچسب‌دار دارد: مشاهده‌شده، برداشت و نامشخص. سطح شواهد را قانون تعیین می‌کند، نه مدل: نشانهٔ مشخص در لاگ، یعنی متغیر SESSION_SECRET تنظیم نشده، به‌اضافهٔ نزدیکی زمانی به آخرین انتشار.» |
| 2:15-2:30 | Point at the banner «توضیح هوشمند در دسترس نیست؛ این شواهد پیدا شد.» | «این نوار یعنی بخش مدل زبانی در این ضبط خاموش است و همه‌چیز را موتور قانون‌محور ساخته. مدل زبانی پیاده‌سازی شده، اما هنوز روی دروازهٔ هوش مصنوعی لیارا آزمایش زنده نشده است.» |
| 2:30-3:00 | Proposal card, approval dialog: tier, effect, cost line (none here), env-key diff without values, collapsed exact API call | «پیشنهاد قبل از اجرا همه‌چیز را نشان می‌دهد: سطح ریسک، هزینه و تغییر دقیق. مقدار متغیرها هرگز نمایش داده نمی‌شود و هوش مصنوعی خودش چیزی اجرا نمی‌کند.» |
| 3:00-3:15 | Confirm; execution progress steps | «پس از تأیید شما، سرور یک‌بار و با توکن یک‌بارمصرف اجرا می‌کند.» |
| 3:15-4:00 | Verification card (about 44 s after approve): 7 checks, the grey/amber `applets_available` row, `restart_observed`, probe window, `error_signature_absent` | «قبول شدن درخواست توسط لیارا کافی نیست. هفت بررسی انجام می‌شود: متغیر اعمال شد، برنامه در حال اجراست، راه‌اندازی دوباره از روی رویدادها دیده شد، سه پاسخ ۲xx پشت‌سرهم، رفتار سایت از ۵۰۰ به ۲۰۰ عوض شد و همان خطا در لاگ نسخهٔ جدید نیست. فقط یک مورد نامشخص است: فراخوانی «اپلت‌ها» در خود لیارا خطای ۵۰۰ می‌دهد، پس همیار آن را سبز نشان نمی‌دهد و به‌جایش وضعیت را از جزئیات برنامه و رویدادها می‌خواند و این را شفاف می‌نویسد.» |
| 4:00-4:15 | Incident report page, Markdown copy; `/activity` audit | «گزارش حادثه و سابقهٔ همهٔ تغییرات ثبت می‌شود.» |
| 4:15-4:45 | Second scenario on `broken-shop-2` (build failure): newest release FAILED, older one still serving, package `express@^99.0.0` named | «در یک سناریوی دیگر، آخرین انتشار در مرحلهٔ ساخت شکست خورده ولی نسخهٔ قبلی هنوز سرویس می‌دهد. همیار بسته و نسخهٔ ناموجود را نام می‌برد و چون راه‌حل خودکار امن ندارد، چیزی پیشنهاد نمی‌دهد.» |
| 4:45-5:00 | Back to the canvas; closing | «همه‌چیز با تأیید شما اجرا می‌شود و فقط وقتی «برطرف شد» می‌نویسیم که بررسی‌ها ثابتش کنند. موارد آزمایش‌نشده را در مستندات صادقانه فهرست کرده‌ایم.» |

Alternative second scenario (about 30 s): `wrong-port` on `broken-shop-2` -> «ناهماهنگی پورت» with strong evidence and an `update_port` proposal; say explicitly that port changes cannot be read back from Liara, so the result may stay «قابل اثبات نیست».

## Contingency plan

- **Pre-record** a clean take of the full path before the live session; keep it ready to play.
- **Second seeded app** (`broken-shop-2`) so a failed take or a hit daily deploy cap does not block you.
- **Liara slow or rate-limited**: the UI shows a countdown or «لیارا پاسخ نداد»; say so rather than retrying on camera. Rate-limit behaviour of Liara has not been probed.
- **Verification takes longer than 44 s** (rolling restart): the settling window allows up to 90 s; keep narrating, do not cut.
- **Offline fallback**: `npm run e2e` drives the UI against a fake Liara (`tests/e2e/fake-liara.ts`); it can illustrate the flow but must be labelled as a simulation.

## What to say about AI, and what NOT to claim

May be said (live-verified 2026-10-23, rule-only mode):

- "Connected to real Liara with a team API key; the canvas, balance (team wallet), logs, events, metrics and releases are real."
- "This product was deployed to Liara by its own deploy code (no Liara CLI), with a persistent disk, a private network and security headers; data survived a restart."
- "Five broken-app scenarios were diagnosed live by the rule engine; the `missing-secret` fix was approved, executed and verified in about 44 s with 7 checks." (evidence: see `tests/fixtures/recorded/live-runs-2026-10-23.json`)
- "Liara's `applets` call returns 500 on its side, so the product shows that check as unknown and falls back to app detail and events, and says so."

May NOT be said (not live-verified):

- That the AI copilot, its tool loop, structured output or Persian prose ran against Liara's AI gateway. It did not: the implementation is offline-tested with a scripted model, and the live runs showed the `llm_unavailable` banner. Say "implemented, not yet validated live".
- That `db-unreachable`, `memory-leak`/OOM, domain/SSL, database create/backup, resize or plan changes, redeploy-previous or team-member permissions were run live.
- That the CPU/RAM thresholds are calibrated in general (one 0.5 vCPU run) or that network metric units are known.
- That prices are an invoice: show them as estimates (the disk price is inferred from one charge).
- That monitoring is real-time or background: it is polling while the page is open.
- That the AI "fixed" anything unless the verification card says `verified`; never describe `not_verified` as success.
- Rollback, DB restore, DNS editing or shell access: none exist.
- That the setup assistant uses an LLM: its analysis and wording are rule-based.
- Model quality in Persian, until `npm run eval` has been run on the chosen model.

## Cleanup

Every demo app and the network keep billing until removed (about 1042 toman/hour per `small-g2` app plus disks).

- Demo apps: delete from the product (tier 3 delete, type the app name) or in the Liara console.
- The deployed product instance and its disk: `ALLOW_BILLED_LIVE_TESTS=1 npx tsx --env-file=.env scripts/deploy-self.ts --destroy --yes --confirm-name <app>` (set `APP_NAME` if you used a custom name).
- Private network: delete it in the Liara console once no app uses it.
- Local state: remove the `data/` folder (local runs) and `scratch/` (spend log and deploy logs, git-ignored).
- Rotate the API key used for the recording.
