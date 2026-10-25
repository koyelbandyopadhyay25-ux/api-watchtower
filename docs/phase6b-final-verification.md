# Phase 6B final local verification

Phase 6B is complete within its local-development/Mailpit scope. All requested final checks passed, with zero failed, skipped or incomplete tests. No migration was rerun, no database was reset/restored over, no external mail was sent, and no Phase 7 work was started.

## Configuration correction

The previous authentication browser failure was caused by missing API launch configuration. Playwright expects the explicitly documented HTTP-localhost cookie exception; the API had correctly used its Secure=true default. Playwright does not start the API automatically, so setting a variable only in the test terminal cannot change an already running API process.

Both browser runs used an API started from the following PowerShell environment, inherited through npm/concurrently into the actual Express process:

```powershell
cd D:\Github\api-watchtower
$env:NODE_ENV = 'development'
$env:ENABLE_LOCAL_MANAGEMENT = 'true'
$env:AUTH_COOKIE_SECURE = 'false' # HTTP localhost development only
npm run dev
```

The existing browser assertions verified HttpOnly, SameSite=Strict, the intended local Secure=false flag, session restoration, expiry, logout invalidation and absence of authentication data in browser storage. Authentication/CSRF/ownership assertions were not relaxed. Cookie security implementation is unchanged: Secure=true remains the default, including outside development. The application remains restricted to localhost; this exception is not a public deployment configuration.

Playwright now uses `maxFailures: 1`, preventing unrelated workflows from continuing after a failure. Both complete browser runs started with a fresh owned API process, retaining the existing process-local login rate limit rather than changing it. No persistent environment file or global environment variable was changed. The dashboard's local setup instructions now include the same explicit cookie exception.

## Exact verification results

| Executed command | Passed | Failed | Skipped | Incomplete |
| --- | ---: | ---: | ---: | ---: |
| `npm run test:db` | 39 | 0 | 0 | 0 |
| `WATCHTOWER_MAILPIT_TEST=true; npm test` — backend | 298 | 0 | 0 | 0 |
| Same command — frontend | 56 | 0 | 0 | 0 |
| Explicit `WATCHTOWER_MAILPIT_TEST=true; npm run test:mailpit` | 1 | 0 | 0 | 0 |
| Initial complete live browser suite | 4 | 0 | 0 | 0 |
| Final complete live browser suite after static checks | 4 | 0 | 0 | 0 |

The full automated suite contains **354 unique tests**. Database and SMTP commands rerun subsets of that suite; do not add their counts again. Each browser run contains the same four workflows. The final browser suite took approximately 1.5 minutes.

`npm run typecheck`, `npm run build`, `npm run db:validate`, Prisma Client generation, and `git diff --check` also passed. Git's existing LF/CRLF notices are line-ending notices, not integrity failures. The previous interrupted run is preserved in [the historical report](phase6b-verification.md); no test failed in this continuation.

## Real browser workflows

1. **Authentication and isolation:** registration/login, two independent users, HttpOnly cookies, session restoration, logout/revoked-cookie rejection, scoped expiry, CSRF refusal, cross-user checks/baseline/schedule/notification settings/history refusal and all nine legacy endpoint refusals.
2. **Manual dashboard:** actual endpoint registration, real HTTPS checks, explicit baseline capture, subsequent comparison, persisted history, refresh and desktop/mobile layouts.
3. **Notifications:** saved preference survives reload; deliberate enablement; a controlled real fetch timeout creates an incident; repeated failures produce one logical alert; actual SMTP failure persists a retry; a new dispatcher process respects the persisted backoff; Mailpit captures the failure; normal HTTPS HTTP 200 records recovery and captures its email; dashboard renders actual delivery history. After disabling, a fresh timeout creates an event with no outbox, dispatcher execution sends nothing, and Mailpit's message count remains unchanged.
4. **Scheduling:** settings persist across reload/browser contexts, stopped-worker inactivity, real scheduled HTTPS HTTP 200 while browser sessions are logged out, independent worker behavior, manual/scheduled source history, and disabled due work skipped across 12 seconds (multiple polling intervals). No production interval or database timestamp was rewritten to accelerate checks.

The timeout demonstration uses the existing secure fetcher with a test-only 1ms deadline on a newly registered demonstration endpoint. DNS/URL/TLS/SSRF validation is not bypassed and no response or check outcome is mocked. This is a deliberately constrained attempt, not a claim that JSONPlaceholder was unavailable. Structural-change transitions/baseline gating are covered by the database and unit suites; a changing external schema was not fabricated for the browser demo.

## Mailpit evidence

Reused the installed, previously checksum-verified official Mailpit v1.32.0 binary at `apps/web/artifacts/tools/mailpit-v1.32.0/mailpit.exe`. No download or unrelated installation occurred. SMTP/UI were loopback-only at 127.0.0.1:1025/8025, with no relay/forwarding and only generated `watchtower+<UUID>@example.test` recipients. Account email addresses were never recipients.

Final notification endpoint: `04c10202-ee5e-41ce-bc74-4dc33df1aefe`.

- Failure event/Message-ID: `dba9ea37-b423-4dbf-b138-7ba83e03cc95@api-watchtower.test`. Persisted SMTP attempt one failed; attempt two was accepted after dispatcher restart and real backoff.
- Recovery event/Message-ID: `9a9295e2-4bde-4357-b517-7c5b0a295686@api-watchtower.test`. Actual HTTPS check returned 200; SMTP attempt one was accepted.
- Disabled-notification verification: `disabledNoNewEmail: true` in the final evidence file. The subsequent failure event has no outbox/email.

Evidence is ignored by Git:

- `apps/web/artifacts/phase6b-live-notifications.json`: final persisted event/attempt metadata and Mailpit API captures.
- `apps/web/artifacts/phase6b-live-notifications-first-complete.json`: first successful run's evidence.
- `apps/web/artifacts/phase6b-final-captured-mail/*.eml`: nine retained messages from all local verification work, including earlier runs and explicit SMTP smoke tests. Only the two Message-IDs above belong to the final browser notification demonstration.
- `apps/web/artifacts/notifications-desktop.png`, `notifications-mobile.png`, `mailpit-capture.png`.
- Existing dashboard/authentication/scheduling screenshots were refreshed by the successful workflows.

Mailpit capture and SMTP acceptance are **not proof of delivery to a real external inbox**. No unverified external recipient was used.

## Database and cleanup

Read-only checks before and after verification confirmed both exact database identities at 127.0.0.1:5432, four completed migrations, their on-disk checksums, and no failed/rolled-back migration. Notification migration checksum remains `cf2775743d771774b3e2748f43044acb62c78b6d32f40a98e86b8ecd624f29f1`. Neither migrations nor backup/restore commands were rerun.

Every original row in all seven pre-notification application tables and all three original migration records still matches its per-row hash in the verified backup manifest. This includes original endpoint owner IDs, baselines, schedules and monitoring history. All nine legacy endpoints remain unclaimed and inaccessible.

| Table | Original backup rows | Final development rows | All original rows unchanged |
| --- | ---: | ---: | --- |
| Endpoint | 17 | 27 | Yes |
| CheckResult | 38 | 64 | Yes |
| SchemaChange | 0 | 0 | Yes |
| EndpointSchedule | 6 | 8 | Yes |
| ScheduledCheck | 7 | 9 | Yes |
| User | 9 | 16 | Yes |
| Session | 3 | 6 | Yes |

New legitimate demonstration history is retained. Development now has three disabled notification preferences, five incidents, eight notification events, six outbox records and nine attempts. The two events created while notifications were disabled have no outbox. The isolated test database contains no leftover fixtures. **Both databases have zero enabled notification preferences and zero enabled schedules.**

All owned API, frontend, dispatcher, scheduler and Mailpit processes are stopped. The final listener check found none on ports 1025, 8025, 3001, 5173 or 55432; the existing PostgreSQL server on 5432 was left running.

Existing backups remain outside Git at `%LOCALAPPDATA%\APIWatchtower\backups\phase6b-20261025-verified`, unchanged. The unusual untracked filename containing `ecure authentication and endpoint ownership` and U+F022 was left untouched, neither staged nor deleted. Its earlier investigation is recorded in the historical report.

## Reproduction and changed files

Use the API/frontend launch environment shown above. For a standalone SMTP smoke test, start Mailpit in a separate terminal:

```powershell
.\scripts\start-mailpit.ps1 -MailpitPath "$PWD\apps\web\artifacts\tools\mailpit-v1.32.0\mailpit.exe"
# Another terminal, with Mailpit active:
$env:WATCHTOWER_MAILPIT_TEST='true'
npm run test:mailpit
```

Stop that standalone Mailpit instance before the full browser suite: the notification workflow owns its Mailpit process and deliberately tests SMTP unavailability/restart. With the API/frontend active and 1025/8025 free:

```powershell
$env:WATCHTOWER_LIVE_E2E='true'
$env:WATCHTOWER_MAILPIT_TEST='true'
npm run test:e2e
```

For interactive delivery, the separate dispatcher remains explicitly opt-in:

```powershell
$env:NODE_ENV='development'
$env:ENABLE_EMAIL_DISPATCHER='true'
$env:EMAIL_DELIVERY_MODE='mailpit'
npm run dev:email
```

Stop foreground processes with Ctrl+C. A dispatcher is not automatically started by `npm run dev`. Scheduled monitoring separately requires `ENABLE_SCHEDULER_WORKER=true` and `npm run dev:worker`; enabling a setting does not prove either worker is running.

Files changed in this continuation: `apps/web/src/App.tsx` (correct local setup instructions), `apps/web/playwright.config.ts` (fail-fast), `apps/api/scripts/verify-notification-preservation.ts` (read-only identity/migration checksum and disabled-schedule checks), `AGENTS.md`, `README.md`, notification/database/dashboard/scheduling/monitoring documentation and this report. Existing authentication implementation, comparison engine, SMTP safeguards and applied SQL were unchanged.

Remaining limits: local development only; no verified external email, bounce handling or public deployment; shared Mailpit UI is local debugging infrastructure rather than an owner-isolated inbox; SMTP crashes around acceptance can produce duplicate captures (at-least-once semantics), and disabling cannot recall an in-flight message. Schema inference still describes observed samples, not a universal contract. Process-local authentication rate limits remain unchanged. No Phase 7 work was started.
