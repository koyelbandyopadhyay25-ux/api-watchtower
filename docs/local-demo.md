# Local portfolio demonstration

This guide demonstrates the existing local product without changing its security model or database schema. It makes real HTTPS requests to the six reviewed destinations and persists results in the local `watchtower_dev` database. Demo accounts, endpoints, checks, baselines, incidents, and notification history remain in that development database; do not delete them as cleanup.

## 1. Prepare the local environment

Use the already migrated local PostgreSQL databases. Follow [database setup](database.md) only if PostgreSQL or credentials are not configured. Do not run database initialization/migration commands against a populated database.

From the repository root, copy the example only if the ignored local file is absent, then set your own local database credentials in `apps/api/.env`:

```powershell
if (-not (Test-Path apps/api/.env)) { Copy-Item .env.example apps/api/.env }
```

Never paste the password into a command, README, screenshot, or Git-tracked file. For localhost HTTP, start the API and Vite together in a PowerShell window:

```powershell
$env:NODE_ENV = 'development'
$env:ENABLE_LOCAL_MANAGEMENT = 'true'
$env:AUTH_COOKIE_SECURE = 'false'
npm run dev
```

The cookie exception applies only to this explicitly enabled local HTTP process. It is not safe for public hosting. Open <http://localhost:5173> and create your own local account. Existing ownerless records are not claimed by new accounts.

## 2. Demonstrate endpoint monitoring

1. Select **Add endpoint**, enter a descriptive name, and choose one of the exact supported provider destinations. Arbitrary URL entry is intentionally unavailable.
2. Open the new endpoint and select **Run check**. The dashboard records the real HTTP status, response time, timestamp, and safe outcome in PostgreSQL.
3. Select **Capture baseline** and confirm deliberately. A fresh real request is used for the accepted structural baseline.
4. Run another check and inspect **Monitoring history** and **Recorded schema changes**. A normal response with the same structure should show no structural differences for that sample. Provider-side schema changes are not guaranteed to occur during a demo; do not edit the database or label unchanged responses as a schema change.
5. Use the endpoint selector and saved schema view to inspect object, array, and nested JSON samples from the supported APIs. The baseline is never replaced by ordinary checks.

## 3. Demonstrate scheduled monitoring (optional)

In a second PowerShell window, start the independent worker:

```powershell
$env:NODE_ENV = 'development'
$env:ENABLE_SCHEDULER_WORKER = 'true'
npm run dev:worker
```

In the dashboard, open **Monitoring settings**, select a frequency (5, 15, 30, or 60 minutes), enable monitoring, and confirm. With the worker running, the initial check is due immediately; later checks follow the selected interval. Refresh the endpoint to see persisted scheduled history. An enabled setting does not mean a stopped worker is running. When finished, disable the schedule in the UI, verify it says **Disabled**, then stop the worker with Ctrl+C.

## 4. Demonstrate incidents and local Mailpit capture

Notifications are disabled by default. The normal six public endpoints are expected to return JSON, so a failure/schema incident is not guaranteed in a short manual demo. Do not use an unapproved URL or tamper with persisted checks to force one.

For a repeatable local notification demonstration, use the real-browser verification workflow below. Its notification test creates a test-owned endpoint and deliberately sets that check's local request deadline to 1 ms to exercise a recorded timeout, deduplication, retry, and then a normal real HTTPS check to exercise recovery. **That controlled timeout is not evidence of a provider outage.** The test runs the real monitoring service and persists its actual outcomes; it then captures resulting messages in a local Mailpit process. Mailpit recipients are generated `.test` addresses only. No real recipient is contacted, and SMTP acceptance is not inbox delivery.

Mailpit is not committed to Git. Install the official Windows binary locally as described in [the notification setup guide](notifications.md#windows-mailpit-setup). The browser test expects it at `apps/web/artifacts/tools/mailpit-v1.32.0/mailpit.exe`; this path is ignored by Git.

## 5. Run all four real browser workflows

Build the worker binaries once, then run the local app in a separate terminal using the settings above. Do not start another monitoring worker or Mailpit process: the scheduling and notification browser workflows start and stop their own test-scoped processes.

In a PowerShell window at the repository root:

```powershell
npm run build
$env:WATCHTOWER_LIVE_E2E = 'true'
$env:WATCHTOWER_MAILPIT_TEST = 'true'
npm run test:e2e
```

The four workflows cover authenticated ownership/CSRF, dashboard registration/check/baseline/history, scheduling persistence and worker independence, and notification retry/recovery with Mailpit. They use the real local API and PostgreSQL and make requests only to approved public endpoints. They leave real development records in `watchtower_dev`; schedules and notification preferences created by the workflows are disabled in cleanup. Test users use randomly generated `.test` addresses and passwords, which are not written to browser storage or displayed in the app history.

Screenshots for the GitHub README are captured during the real dashboard browser workflow and copied to `docs/screenshots/`. They reflect the persisted state at capture time. Screenshots are not monitoring fixtures.

## 6. Stop and inspect

- Disable any schedules or local notification preferences that you enabled manually.
- Stop the API/Vite process with Ctrl+C. Stop any worker or standalone Mailpit process that you started.
- The automated browser workflows stop their own Mailpit/worker processes. They do not reset databases or delete generated history.
- `http://127.0.0.1:8025` is the local Mailpit UI when Mailpit is running. Keep it private to the machine; its capture inbox is shared local debugging infrastructure.

## Limits to keep visible during a demo

- Only the six exact approved HTTPS URLs are accepted; no arbitrary domains, credentials, headers, queries, or redirects.
- IPv6 outbound fetching is disabled. Application DNS/IP pinning and TLS checks do not provide an isolated cloud egress boundary.
- A check describes one observation from this machine, not provider-wide availability. A lack of schema changes does not establish complete compatibility.
- Scheduled checks only occur while the separate worker process is running.
- Notifications only enter local Mailpit. There is no external email delivery, recipient verification, public deployment, or public user registration service.
