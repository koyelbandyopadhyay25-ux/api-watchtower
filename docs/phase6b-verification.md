# Phase 6B verification — stopped at the requested failure gate

**Historical report.** The subsequent authorized continuation corrected the API's local HTTP environment and completed verification successfully. Read [the final Phase 6B report](phase6b-final-verification.md). The failure and partial counts below are retained as an audit record, not the current status.

## Outcome

Migration `20261025160000_add_notification_outbox` was approved, reviewed in full and applied to `watchtower_test` first, then `watchtower_dev`. Both targets were verified as `127.0.0.1:5432` and had the three expected completed migrations/checksums beforehand. The unchanged SQL SHA-256 is `cf2775743d771774b3e2748f43044acb62c78b6d32f40a98e86b8ecd624f29f1`.

SQL adds only five tables, four enums, indexes, foreign keys and new-table constraints. No existing-table columns, ownership assignments, historical backfill, or destructive statements were applied. Immediately after each migration, all five new tables were empty; all previous table contents and hashes were identical.

## Backups and preservation

Private backups are outside Git at `C:\Users\Koyel Bandyopadhyay\AppData\Local\APIWatchtower\backups\phase6b-20261025-verified`:

- `watchtower_test.dump`, `watchtower_dev.dump`: PostgreSQL 18 custom-format archives.
- `manifest.json`: archive SHA-256, original per-row/whole-table hashes, counts, source/restored identities.
- Archive table-of-contents files and the stopped `restore-verification-cluster`.

Both archives were actually restored into NEW verification databases in a separate SCRAM-authenticated cluster bound only to `127.0.0.1:55432`. All restored row hashes, counts and original migration records matched their sources. The verification cluster is stopped. No existing database was reset, dropped, truncated or recreated. Archive restoration used `--no-owner --no-privileges` with a dedicated verifier role; database archives are not a backup of cluster-global roles. Treat the archives as sensitive because they include application password hashes/session data. The backup directory has an explicit current-Windows-user-only inherited ACL.

The first launcher attempt encountered Windows inherited-pipe blocking; only its owned script/temporary cluster were stopped. No source database was changed. The corrected launcher completed in the separate `-verified` directory. The unused first verification directory was retained, not deleted.

Final read-only verification checked every original row against its per-row hash, allowing newly created demonstration records:

| Table | Original dev rows | Current dev rows | Original rows unchanged |
| --- | ---: | ---: | --- |
| Endpoint | 17 | 19 | Yes |
| CheckResult | 38 | 44 | Yes |
| SchemaChange | 0 | 0 | Yes |
| EndpointSchedule | 6 | 6 | Yes |
| ScheduledCheck | 7 | 7 | Yes |
| User | 9 | 12 | Yes |
| Session | 3 | 6 | Yes |

All three original migration rows are unchanged; each database now has four. Test fixtures cleaned up their own records; test tables are empty. Development has one disabled notification preference, one incident, two events/outbox records and three delivery attempts from the live demonstration. **Zero enabled notification preferences remain.** Original endpoint hashes include owner IDs, so legacy ownership was preserved.

## Executed checks

| Command/check | Passed | Failed | Skipped / incomplete |
| --- | ---: | ---: | --- |
| `npm run test:db` | 39 | 0 | 0 |
| `npm test` backend | 297 | 0 | 1 Mailpit opt-in test |
| `npm test` frontend | 56 | 0 | 0 |
| Explicit `WATCHTOWER_MAILPIT_TEST=true; npm run test:mailpit` | 1 | 0 | 0 |
| Live browser suite, interrupted at failure gate | 1 | 1 | 1 interrupted, 1 not run |
| TypeScript checks (two runs before failure) | Passed | — | Final post-stop rerun not performed |
| Production builds | Passed | — | Final post-stop rerun not performed |
| Prisma generation | Passed | — | Explicit Prisma validation not run this turn |
| `git diff --check` | Passed | — | LF/CRLF notices only |

The 39 PostgreSQL tests include 12 notification tests covering failure/recovery, schema-baseline gating and restoration, duplicate suppression, transaction rollback, scheduling persistence, multiple dispatchers, expired leases/stale acknowledgements, retry exhaustion, disable/in-flight behavior, preference conflicts and cross-user isolation. Existing authentication/monitoring/scheduling tests passed. Counts from separate commands overlap; do not add database tests again to the full-suite totals.

## Browser failure and stop

`apps/web/e2e/authentication.spec.ts:41` expected cookie `secure=false` for the documented local HTTP exception, but received `true`. `AUTH_COOKIE_SECURE` is **unset**, so the API correctly used its secure default. No authentication setting was changed to make the test pass. The test stopped before its cross-user route assertions; component/database isolation tests did pass. This is a configuration/assertion mismatch, not evidence that authorization was bypassed.

Error evidence: `apps/web/test-results/authentication-real-cookie-db486-usal-CSRF-logout-and-expiry/error-context.md`. The existing dashboard workflow passed. Playwright began later tests automatically before the failure was observed; the runner was then terminated. The notification workflow was interrupted after capture and disabling; its final disabled-no-new-email assertion and the scheduling browser workflow did not complete. No formal pass is claimed for the interrupted notification workflow.

For a future explicitly authorized continuation using HTTP localhost, the existing documented development exception is `$env:AUTH_COOKIE_SECURE='false'` on the API process. This is not suitable for public deployment. An alternative is making the test accept the secure default while asserting HttpOnly/SameSite and real session behavior. Neither change was made after the failure gate.

## Mailpit evidence

Mailpit was absent. Only its official Windows amd64 v1.32.0 archive was downloaded into ignored `apps/web/artifacts/tools/mailpit-v1.32.0`. Published/archive SHA-256 matched: `16915767a6c95dca569336e8f561f91cf355e9a33c57b91deedcc10a4bba7fd4`. No service or unrelated software was installed.

It was bound only to `127.0.0.1:1025` and `127.0.0.1:8025`, with no relay/forwarding, local Host restriction and generated `.test` recipient restriction. The sender uses a literal loopback SMTP destination and never the account email address. One smoke-test fixture plus two real persisted-event messages were captured; SMTP acceptance is not external inbox delivery.

- Failure event `31bbb78f-7092-4265-8652-24b08a1d3597`: actual secure-fetcher attempt with test-only 1ms deadline, recorded `network_error/timeout`; one incident despite a repeated timeout. This is controlled local fault injection, not a claim that JSONPlaceholder was down.
- First real SMTP attempt with Mailpit stopped failed and persisted retry state. A new dispatcher process honored persisted backoff without rewriting database time, then Mailpit accepted the second attempt.
- Recovery event `e40f72b7-f97f-47e5-90d4-97228bca2c6f`: normal real HTTPS check returned HTTP 200, recorded success; Mailpit accepted attempt one.
- Both events have persisted `smtp_accepted` outbox state. Captures were checked through the Mailpit HTTP API during the interrupted workflow, and subsequently exported read-only from the stopped capture database to `apps/web/artifacts/phase6b-captured-mail/*.eml`.
- Screenshots: `apps/web/artifacts/notifications-desktop.png`, `notifications-mobile.png`, plus updated `dashboard-detail.png`, `dashboard-desktop.png`, `dashboard-mobile.png`. The notification screenshots are evidence of partial execution, not a passed E2E test. A separate Mailpit UI screenshot was not completed.

All owned API/Vite/Mailpit processes and temporary restore servers are stopped; no listeners remained on ports 1025, 8025, 3001, 5173 or 55432 at the final check. No demonstration scheduler remained active. No external email was sent or enabled.

Official setup: https://mailpit.axllent.org/docs/install/ and https://github.com/axllent/mailpit/releases/tag/v1.32.0. Extract the matching Windows archive, compare its published SHA-256, then use the existing guarded helper:

```powershell
.\scripts\start-mailpit.ps1 -MailpitPath "$PWD\apps\web\artifacts\tools\mailpit-v1.32.0\mailpit.exe"
# Separate terminal, after an authorized continuation:
$env:NODE_ENV='development'
$env:ENABLE_EMAIL_DISPATCHER='true'
$env:EMAIL_DELIVERY_MODE='mailpit'
npm run dev:email
# Ctrl+C stops each foreground process.
```

## Unusual untracked file

`ecure authentication and endpoint ownership` followed by U+F022 is a 1,731-byte UTF-8 file created at 2026-10-25T15:25:57Z. It contains only 52 Phase 6A repository paths, consistent with redirected `git diff --name-only` output into a malformed filename. No source code or credentials were found. Its creation predates this work; available PowerShell history had no matching command, so the precise originating command cannot be proven. It was neither staged nor deleted.

## Changes in this continuation and remaining work

Added readable operational scripts: `verify-notification-backups.ts`, `apply-notification-migration.ts`, `verify-notification-preservation.ts`, `notification-demo-check.ts`; added `apps/web/e2e/notifications.spec.ts`; extended authentication browser assertions for notification ownership/CSRF; updated status documentation. The reviewed migration SQL and existing security controls were not altered. Earlier uncommitted Phase 6B implementation changes remain intact.

Do not claim Phase 6B fully verified. Resolve the cookie-test configuration mismatch only in an authorized continuation, then rerun the complete browser suite with fail-fast execution, complete disabled-no-new-email and scheduling verification, run full suites with explicit Mailpit opt-in, and repeat final typecheck/build/Prisma validation/integrity checks. Do not reapply migrations or replay historical notifications. No Phase 7, public deployment, external email, URL expansion or authentication bypass was implemented.
