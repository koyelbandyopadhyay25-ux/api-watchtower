# Opt-in monitoring worker (Phase 5A)

**Phase 6A:** user-facing schedule APIs require session authentication, ownership and CSRF on writes. The worker still uses the trusted internal service without browser credentials; logout does not stop opted-in schedules. No worker/SSRF/coordination policy was relaxed. Authentication's approved additive migration is applied to both databases; real worker execution after logout is verified. See [authentication migration and verification](authentication.md).

## Verified status and migration approval

Phase 5A is verified. Migration `20261025121417_add_endpoint_scheduling` was explicitly approved, applied to `watchtower_test`, and passed all 11 scheduling plus 9 existing database tests before application to `watchtower_dev`. Subsequent timezone regressions bring the final database suite to 22 passing tests. Both databases have a completed migration with checksum `480971c01b389c9159a758432b8b652176566ce14de4141ed189d6b4b90a66fe`.

Read-only inspection found PostgreSQL 18.6 on `127.0.0.1:5432`. The original 3 development endpoints and 9 checks remain unchanged, verified by per-row hashes before migration and after all demonstrations. Development now contains 5 endpoints and 12 checks: the original records plus two real verification endpoints and three actual scheduled checks. No initial setup, reset, drop, or data replacement was performed. All schedules are disabled and verification workers stopped; no background monitoring is currently running.

The first live demonstration exposed a timezone-dependent decoding error. Development writes were paused while a UTC-session/epoch-clock fix was validated in the isolated database. The corrected demonstration then verified real storage, no execution while stopped with a due endpoint, and one resumed check after restart. See the detailed verification record below; historical rows were not rewritten.

## Architecture

`apps/api/src/worker/main.ts` is a separate Node process. It opens no HTTP port and needs no browser. It reads due schedules from PostgreSQL, then calls the **same monitoring service** used by manual checks. That service reuses the existing secure HTTPS fetcher, inference/comparison engine, structural baseline, and result repository. No request headers, authentication, redirects, body storage, or new URL destinations are added.

`EndpointSchedule` is an optional row per endpoint: opt-in enabled flag, supported interval, next due time, last committed start/finish times, and safe last error category. **No row means disabled.** Existing endpoints receive no backfilled rows and remain disabled. `ScheduledCheck` links a real saved check to its endpoint and due slot, making scheduled provenance queryable without changing existing history records or frontend API types.

Allowed intervals are exactly 5, 15, 30, and 60 minutes. First enablement is due immediately, so an active worker can verify the endpoint without waiting five minutes. Repeated identical settings preserve the due time. Changing an already enabled interval schedules from database time plus the new interval. Disabling clears the due time; it does not delete history or a baseline.

After a committed attempt, the next due time advances to the first interval boundary strictly after completion. Overdue work runs once and skips missed slots; the worker never replays every missed interval. PostgreSQL time is authoritative for due decisions and advancement. Application clocks control only polling/backoff and actual request timestamps/timing.

## Coordination and resource limits

Manual checks, baseline captures, and scheduled checks all enter `repository.runExclusive`. It starts a bounded PostgreSQL transaction, takes a nonblocking transaction-level advisory lock derived from the endpoint UUID, and reserves one of three database-wide advisory execution slots. Schedule settings share the endpoint lock but need no execution slot. The key spaces are fixed and consistent across all API/worker instances using the same database.

The same transaction performs the fresh endpoint/schedule reads, actual check-result/schema-change writes, scheduled provenance insert, and due-time advancement. If another worker selected the same stale candidate, the lock or the fresh due-state read prevents a second check. A unique `(endpointId, scheduledFor)` constraint further protects committed slot provenance. A failed/abandoned transaction leaves the due time unchanged and cannot leave a committed check with an unadvanced schedule.

Transaction-level locks are automatically released at transaction end, as documented by [PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS). A crash/connection loss rolls back uncommitted writes and releases ownership; a restarted worker can retry still-due work. No expiring application lease, Redis, cron service, or external queue is required.

The intentional tradeoff is holding at most three DB connections across bounded public network operations. HTTPS keeps its existing 8-second absolute deadline, DNS/IP pinning, hostname TLS verification, 128-KiB response limit, JSON limits, redirect refusal, and exact two-URL allowlist. The coordination operation has a 15-second cancellation budget and a 25-second transaction limit, with 3-second SQL statement and 1-second row-lock timeouts. Cancellation propagates into the existing fetcher. API connection pools remain bounded.

There is one nonoverlapping poll batch at a time, at most three candidates per batch, then a 5-second wait. Busy endpoints/capacity are skipped without fabricated check rows. Upstream HTTP/JSON/timeouts are actual saved failures and advance cadence normally. Unexpected per-endpoint failures roll back and receive a 30-second local retry backoff, while other due endpoints remain eligible. Poll failures are logged safely and retried; they do not crash the loop. Backoff is an in-memory optimization, while due state and all committed results are durable.

This does **not** promise exactly-once external HTTPS execution. A process/network failure after the remote GET but before commit may cause a later retry; a lost/paused connection may take time to be detected. Database state/result commits remain atomic and fenced by the transaction, and normal admitted checks cannot overlap across API/worker instances. The public GET requests are unauthenticated/read-only. Do not disable TLS/destination checks to make retries succeed.

Baseline capture remains manual. A scheduled check never calls acceptance, even after a change or failed request. A failed explicit capture still commits its actual failure check and reports 422 after commit; a stale optimistic baseline update also reports conflict after committing the check. An actual database/transaction failure may roll back the whole operation and must not be described as a saved result.

## Safe forward migration plan

Review [the migration SQL](../apps/api/prisma/migrations/20261025121417_add_endpoint_scheduling/migration.sql). It creates only two new tables, their indexes, constraints, and foreign keys. It makes no changes to existing endpoint/check/change columns or rows and does not backfill or enable schedules. Transactional DDL and short lock/statement timeouts keep failure atomic and bounded. Foreign keys may briefly need locks on referenced tables; a busy migration fails rather than waiting indefinitely.

The interval and enabled/due invariants are PostgreSQL CHECK constraints in the migration, in addition to application validation. Prisma does not express those CHECK constraints in its schema language; retain them in future forward migrations. The migration is now applied locally; the commands below document the approved forward-only procedure and must not be confused with a request to reinitialize existing databases.

Read-only review command:

```powershell
npm run db:schedule:plan
```

The helper verifies exact local database identities, completed known migration history/checksums, absence of unexpected pending migrations, and monitoring row counts, then prints the pending SQL checksum. It never logs credentials. It does not require pretending the populated development database is disposable.

**Only after explicit approval to apply this concrete migration**, apply to the isolated test database first:

```powershell
$env:SCHEDULING_MIGRATION_APPROVED = 'true'
npm run db:schedule:apply -- test
npm run test:db
```

After those tests succeed and with development application also approved:

```powershell
npm run db:schedule:apply -- development
Remove-Item Env:SCHEDULING_MIGRATION_APPROVED
npm run db:generate
npm test
npm run typecheck
npm run build
```

Application uses `prisma migrate deploy`, never migrate reset, db push, or the initial setup script. The helper refuses unknown/failed migration history and does not attempt automatic repair. It also supports read-only target inspection with `npm run db:schedule:plan -- test` or `-- development`. Approval is a one-time terminal setting, not something to save as true in an environment file.

## Launch and stop

After the approved migration, keep existing credentials in `apps/api/.env`. Worker startup requires both flags in its **own** terminal; it refuses remote/production database targets and requires the disposable confirmation for `watchtower_test`.

```powershell
$env:NODE_ENV = 'development'
$env:ENABLE_SCHEDULER_WORKER = 'true'
npm run dev:worker
```

For a compiled worker after `npm run build`, use `npm run start:worker` with the same flags. `npm run worker:once` runs one bounded poll batch and exits; it is not a persistent worker. `npm run dev` continues to start only API and frontend. No worker is started just by opening the dashboard.

Stop the worker with Ctrl+C. It stops admitting new work, drains admitted bounded operations, disconnects, and logs `worker_stopped`. Forced termination rolls back unfinished transactions. Persistent opt-ins remain enabled after stopping, but **no scheduled checks run while no worker process is active**. A later explicitly started worker resumes overdue work once. Disabling an endpoint persists across worker restarts.

The separate API terminal still needs `NODE_ENV=development` and `ENABLE_LOCAL_MANAGEMENT=true`. The worker never exposes a public management interface or changes those guards.

## Local schedule interface

All routes inherit the existing local-development opt-in, loopback peer/Host, Origin restrictions, no forwarded headers, JSON limit, and `X-Watchtower-Local: 1` requirement.

| Method/path | Meaning |
| --- | --- |
| `GET /api/endpoints/:id/schedule` | Persisted configuration/state, or explicit disabled defaults when no row exists |
| `PUT /api/endpoints/:id/schedule` | Exact body `{ "enabled": true, "intervalMinutes": 5 }`; both fields required |
| `GET /api/endpoints/:id/scheduled-checks?limit=50` | `{ "runs": [...] }`, newest due slot first, with actual nested `checkResult` and schema changes |

Settings responses contain `endpointId`, `enabled`, `intervalMinutes`, `nextRunAt`, `lastStartedAt`, `lastFinishedAt`, `lastErrorCode`, and `updatedAt`. Null start/finish times mean no committed scheduled attempt; no success data is invented. An enabled flag is configuration, not evidence that a worker is alive. Worker/process liveness and next-run predictions are not fabricated by the API or dashboard.

An active check/configuration owns the endpoint lock: conflicting manual/configuration requests receive 409 and can be retried after completion. A disable request returning 409 has **not** disabled anything. Changing settings does not cancel an already admitted check; wait for it to finish and retry. Global execution capacity returns 429 for manual checks. Unsupported intervals/URLs and extra fields are rejected.

Existing `GET /api/endpoints/:id/checks` includes all actual checks, manual and scheduled. Phase 5B adds `scheduledCheck` relation metadata to this read response and persisted schedule controls to endpoint detail. The dashboard distinguishes scheduled/manual provenance, requires confirmation to enable, and does not invent worker health. See [dashboard controls and live browser verification](dashboard.md#persisted-monitoring-controls-phase-5b). Refresh loads new saved records; the independent worker remains required.

## Real verification without a browser

With the approved migration, API, and independently enabled worker running in separate terminals:

```powershell
& .\scripts\demo-scheduling.ps1
```

The demonstration registers its own allowlisted todo endpoint, explicitly enables a 5-minute schedule (immediately due), and waits for the worker to store a real scheduled result. It never calls the manual check or baseline acceptance routes. It prints actual provenance/status/timing and confirms the baseline remains missing. It disables only its own schedule in `finally` and retains the real endpoint/check history. A failed upstream request remains a printed persisted failure; a missing worker causes a timeout, not invented activity.

For an existing opt-in endpoint, configure and inspect explicitly:

```powershell
$localHeaders = @{ 'X-Watchtower-Local' = '1' }
$endpointId = '<your registered endpoint UUID>'
$scheduleUrl = "http://127.0.0.1:3001/api/endpoints/$endpointId/schedule"
Invoke-RestMethod -Method Put $scheduleUrl -Headers $localHeaders -ContentType 'application/json' `
  -Body (@{ enabled = $true; intervalMinutes = 15 } | ConvertTo-Json)
Invoke-RestMethod $scheduleUrl -Headers $localHeaders
Invoke-RestMethod "http://127.0.0.1:3001/api/endpoints/$endpointId/scheduled-checks" -Headers $localHeaders
# Persistently disable future work; retry if a check currently owns the endpoint.
Invoke-RestMethod -Method Put $scheduleUrl -Headers $localHeaders -ContentType 'application/json' `
  -Body (@{ enabled = $false; intervalMinutes = 15 } | ConvertTo-Json)
```

## Verification scope

Tests cover controlled due/cadence calculations, disabled/default states, opt-in configuration, safe polling/backoff/shutdown, existing HTTP protections plus external cancellation, local schedule-route validation, and real PostgreSQL advisory contention without requiring the new schema. Eleven additional scheduling DB tests automatically skip when the approved migration is not present; they are not counted as passed. Once migrated they test real persistence, due advancement, failures/recovery, multiple workers, manual/scheduled/baseline exclusion, global capacity, atomic rollback/restart, idempotent updates, and database invariants.

Pre-migration verification actually executed (historical record):

| Check | Result |
| --- | --- |
| Backend suite | 197 passed, including 9 existing-schema PostgreSQL integration tests; 11 new-schema scheduling tests skipped |
| Frontend suite | 28 passed |
| Combined suite | 225 passed; 11 skipped; no failures in final run |
| TypeScript checks and production builds | Both workspaces passed |
| Prisma validation and Client generation | Passed |
| Read-only migration plan | Both databases verified; new migration pending; development still has 3 endpoints and 9 checks |
| New scheduling DB suite and real worker/demo | Pending explicit migration approval; not claimed as passed |

One initial shutdown unit assertion incorrectly expected queued work to start after cancellation. It was corrected to verify that already-started work drains while later candidates are not admitted; the final suite passes.

All integration writes target the separately confirmed `watchtower_test` database, remove only suite-owned rows, and never initialize/reset/truncate a database. API test files run sequentially because deliberate global-capacity tests must not consume one another's slots.

## Final verification record

| Check | Final actual result |
| --- | --- |
| Test-first migration | Applied successfully to `watchtower_test`; original 11 scheduling and 9 other DB tests passed before development migration |
| Development migration | Applied the same reviewed SQL to `127.0.0.1:5432/watchtower_dev`; no existing schedule enabled |
| `npm run test:db` after timezone regression additions | 22 passed, 0 failed, 0 skipped |
| `npm test` backend | 210 passed across 9 files |
| `npm test` frontend | 28 passed across 2 files |
| Combined automated suite | 238 passed, 0 failed, 0 skipped |
| TypeScript, production builds, Prisma validation | Passed for the applicable workspaces/schema |
| Corrected real worker demonstration | HTTP 200 persisted; 448 ms actual request time; baseline remained missing |
| Stopped-worker check | No worker processes; endpoint enabled and immediately due; scheduled history stayed at 1 record over 12 seconds (>2 poll periods) |
| Restart check | Previously due slot processed once; second HTTP 200 saved, 2535 ms actual request time |
| Final cleanup/integrity | All schedules disabled, workers stopped; original 3 endpoints and 9 checks hash-identical |

The first live run revealed a 330-minute offset between `databaseTime()` and the actual UTC instant. Native PostgreSQL epoch and Node time agreed; timezone-sensitive timestamptz decoding under the server's `Asia/Calcutta` default did not. No further development writes occurred while the fix was validated on the isolated test database. Application connections now set their own session timezone to UTC (no server settings changed), and the scheduling clock uses epoch milliseconds. Two regression tests cover a non-UTC transaction timezone and actual stored/ORM timestamp equality. The fixed repository/application clocks agreed within 2 ms in read-only verification.

The first diagnostic endpoint (`86ce4539-51c5-4b57-bcd1-5b54de1eb6a8`) and its one check remain intact, including its **pre-fix scheduling timestamp**. It is disabled. No historical timestamps were rewritten. A fresh corrected endpoint (`22490ead-bb24-4761-ac8a-5e67bcee239d`) holds the two correctly timed real scheduled checks, including the restart result; it is disabled too. These are real verification records, not fabricated incidents or metrics.

After starting the local API, retrieve the corrected demonstration with:

```powershell
$localHeaders = @{ 'X-Watchtower-Local' = '1' }
Invoke-RestMethod 'http://127.0.0.1:3001/api/endpoints/22490ead-bb24-4761-ac8a-5e67bcee239d/scheduled-checks' -Headers $localHeaders
```

Verification used an isolated local API listener on port 3002 and stopped it afterward; normal launch defaults remain port 3001. The browser end-to-end test was not rerun for this backend phase; the existing 28 frontend tests and frontend build passed. No alerting, authentication, broader URL fetching, dashboard redesign, deployment, or Phase 5B work is included.
