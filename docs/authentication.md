# Authentication and ownership — Phase 6A

## Status

Phase 6A is implemented and verified. Migration **`20261025150000_add_authentication_ownership` was explicitly approved and applied to `watchtower_test` first**. All 27 database tests and all regressions passed before application to `watchtower_dev`. Original monitoring data is unchanged and all nine legacy endpoints remain unclaimed. Live authentication, two-user isolation, dashboard behavior and independent worker execution after logout are verified. Do not reapply or initialize these populated databases.

Read [the complete SQL](../apps/api/prisma/migrations/20261025150000_add_authentication_ownership/migration.sql). Its SHA-256 is `465808d0077be06540a6a8199357e4bb80c73c43fb5f299009bd0260ac291fd6` (LF checkout). The read-only plan prints the checksum for the exact file being reviewed. The existing applied migration files were not changed.

## Architecture and request boundary

The existing independent comparison, HTTPS fetcher, monitoring service, repositories, and scheduling worker remain in place. The API now mounts authentication behind the **same** explicit development opt-in, loopback peer/Host, Origin allowlist, custom local header, forwarded-header refusal, and bounded JSON parser. There is no public registration interface and no unauthenticated legacy management mode.

`src/auth/auth-repository.ts` persists users/sessions through Prisma. `auth-service.ts` validates credentials, performs Argon2id hashing/verification, issues and verifies sessions, and revokes logout sessions. `auth-routes.ts` owns cookies, authentication middleware, CSRF enforcement and rate limits. HTTP monitoring routes always pass the session's user ID to the existing service; no request body can choose an owner.

Endpoint registration saves that owner, and listing filters by it in SQL. Detail, history, scheduled history and schedule reads check ownership before returning data. Manual checks, baseline acceptance and schedule writes recheck it inside the existing PostgreSQL-coordinated operation before fetching or changing state. Foreign-owned, unclaimed and nonexistent UUIDs all return `404 endpoint_not_found` to an authenticated user. Missing/forged/expired sessions return `401 authentication_required`; an `Authorization` header cannot substitute for a cookie. UUID spelling normalization and all existing destination/resource protections remain unchanged.

The service's optional owner argument is a **trusted internal interface**, not an HTTP option. The worker continues to invoke it directly, without a browser session or login credentials. It retains the existing PostgreSQL locks/global capacity, UTC clock handling, secure fetcher, cadence, result persistence, and explicit-baseline policy. Logging out does not stop an opted-in schedule. Existing unclaimed schedules, if enabled independently before migration, retain their internal execution behavior; ownership controls user access, not worker liveness. No schedule or history is altered by this migration.

## Passwords and sessions

- Passwords use the established `argon2` package with Argon2id, 19,456 KiB memory, 2 iterations and parallelism 1. Each hash has a library-generated random salt. These parameters meet the [OWASP Argon2id minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). No password, hash, cookie or raw driver exception is logged.
- Email is ASCII, trimmed/lowercased, bounded to 254 characters and unique. Passwords are not trimmed; accepted length is 12–128 Unicode code points, with a 512-byte UTF-8 cap. HTML form limits are additionally conservative for surrogate pairs. Login errors do not distinguish an unknown email from a wrong password, and unknown users still undergo real Argon2 verification. Registration returns the same 202 message for a duplicate email; it never changes that user's password or signs the registrant into an existing account.
- A successful login creates a fresh 256-bit random session identifier. Only its SHA-256 digest is stored in `Session`. The cookie is host-only, HttpOnly, SameSite=Strict, Path=/api, with an absolute eight-hour lifetime. No JWT or bearer identifier is placed in JSON, URLs, localStorage or sessionStorage. Login rotates/revokes a presented old session after successful verification. Logout deletes the current server session before clearing its cookie. Other independent sessions are unaffected.
- Expiry is checked on every authenticated request; expired rows cannot authenticate even if a client keeps its cookie. React also removes protected content at the known expiry or after a 401. Expired rows are retained until a future separately reviewed cleanup policy; there is no automatic destructive sweep.
- Login permits 10 attempts per client IP per 15 minutes; registration permits 5. `express-rate-limit` uses the actual peer with proxy trust disabled; existing forwarded headers remain rejected. Hash/verification operations have an additional two-operation concurrency cap. These are process-local limits and reset on API restart, as [the library documents](https://express-rate-limit.mintlify.app/reference/configuration); shared/persistent abuse protection and public deployment require a separate review.

## Cookies, CSRF and local HTTP

Cookies are Secure **by default**. The only exception is explicitly setting `AUTH_COOKIE_SECURE=false` while `NODE_ENV=development`, with all local-only guards still enforced. For the current HTTP Vite setup, add this variable to the ignored `apps/api/.env` or the backend terminal. No existing credentials need changing. Verification used terminal settings and did not edit the local environment file.

**This HTTP exception is for localhost development and is not suitable for public deployment.** Keep Secure cookies with HTTPS. Production management remains disabled even if cookie settings are changed; no proxy trust, HTTPS/public origin policy, deployment or authentication shortcut was added.

Cookie-authenticated state-changing requests require a session-specific random synchronizer token in `X-CSRF-Token`, checked with constant-time comparison. `/auth/session` and successful login return this token, which the frontend keeps only in memory. Login/registration, before a session exists, require an allowed Origin, JSON content type and the non-simple `X-Watchtower-Local` header under the existing no-CORS policy. Missing/hostile Origins, ordinary cross-origin forms and missing custom headers are rejected. Logout requires both Origin and the authenticated synchronizer token. SameSite is additional protection, not the only CSRF boundary; this follows the [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

The frontend intentionally changes fetch credentials from `omit` to **`same-origin`** so the Vite proxy carries the HttpOnly cookie. All other management security boundaries remain. Secrets and Prisma are never bundled into React. The root `Authentication` component restores the session before mounting the dashboard; component-only dashboard tests still test those components directly. The backend remains the authorization boundary regardless of React navigation.

## Authentication routes

All require `X-Watchtower-Local: 1` and the existing local guard. Auth POSTs additionally require an allowed Origin and JSON.

| Method/path | Input and response |
| --- | --- |
| POST `/api/auth/register` | Exact `{email,password}`; 202 generic processing message; no automatic login |
| POST `/api/auth/login` | Exact `{email,password}`; sets HttpOnly cookie; returns `{user:{id,email},csrfToken,expiresAt}` |
| GET `/api/auth/session` | Cookie required; returns current public user, CSRF token and absolute expiry |
| POST `/api/auth/logout` | Exact `{}`, cookie and CSRF required; revokes current session, clears cookie, returns `{ok:true}` |

Authentication format errors are 400, generic invalid login is 401, missing authentication is 401, CSRF/Origin refusal is 403, limits are 429, and database failures are safely categorized. The process health route still does not assert database readiness.

## Applied migration and legacy ownership

The additive SQL creates `User` and `Session`, their primary/unique keys and indexes, and their relationship. It adds nullable `Endpoint.ownerId`, an `(ownerId,createdAt)` index, and a restricted owner foreign key. User deletion is restricted while owned endpoints exist; session deletion cascades only when its user is deleted. No account deletion route is introduced. CHECK constraints enforce normalized email and expiry after creation; retain these SQL constraints in future migrations because Prisma's schema does not express them.

**No backfill or legacy claiming is included.** Existing rows receive SQL NULL in the new nullable column. Every previous baseline, check, change, timestamp, schedule and provenance row stays intact. Every newly registered user initially sees none of that unclaimed data. There is no first-user administrator, shared legacy account, seed password, owner selection field or claim endpoint.

If ownership of particular legacy endpoints is wanted later, propose an explicit mapping from reviewed endpoint UUIDs to an already registered user UUID and obtain separate approval. Such an operation must use the existing endpoint lock and a conditional NULL-owner update, preserving historical columns. This phase provides no automatic reassignment mechanism.

The migration is wrapped in a transaction with a 2-second lock timeout and 15-second statement timeout. Adding the column, index and foreign key takes short database locks and could fail safely if the database is busy. It does not reset, drop, truncate, insert, update existing rows or rewrite data. Failure is not permission to reset, retry destructively or repair migration history automatically. An offline Prisma old-schema/new-schema diff confirmed the intended additions; it did not use a shadow database or execute SQL. Extra CHECK constraints/timeouts were reviewed separately.

## Read-only inspection and approved application sequence

```powershell
npm run db:auth:plan
```

This command has **no apply mode**. It verifies exact local database targets and server identity, known completed migration checksums, and a consistent pending or completed authentication schema. All database statements run inside read-only transactions. It prints counts and whole-table content hashes without credentials, emails, response bodies or records.

Pre-migration inspection (historical):

| Target | Applied migrations | Existing monitoring data |
| --- | --- | --- |
| `127.0.0.1:5432/watchtower_test` | Initial + scheduling; both checksums match | 0 endpoints, checks, changes, schedules or scheduled provenance rows |
| `127.0.0.1:5432/watchtower_dev` | Initial + scheduling; both checksums match | 9 endpoints, 22 checks, 0 changes, 4 schedules, 5 scheduled provenance rows |

At that checkpoint authentication tables and the owner column were absent in both. All three migrations are now completed and checksum-verified on both databases. Neither initial database preparation nor the older scheduling apply helper is appropriate here; the latter deliberately refuses an unexpected additional migration.

**Approved and completed:** the guarded `scripts/authentication-migration.ts test` verified the reviewed SQL checksum, target, existing migrations and absence of partial schema, saved a hash-only snapshot, then ran `prisma migrate deploy`. All 27 database tests and 291 automated tests passed, along with typechecks/builds/validation, before the separate approved development application. The helper recorded 9 endpoints and 22 checks, applied the identical SQL, and verified original hashes and NULL ownership immediately afterward. It refuses unexpected migrations, changed SQL, target mismatches, overwriting snapshot files and reapplication. No reset, drop, truncate, database recreation, backfill or ownership assignment was performed.

Preservation can be reverified read-only:

```powershell
npm run db:auth:verify
```

This compares all 40 original rows across five monitoring tables against locally captured per-row hashes, excluding only the newly added endpoint owner column and verifying its legacy values remain NULL. It separately checks all three completed migration checksums. Snapshots are ignored artifacts at `apps/web/artifacts/phase6a-development-before.json` and `phase6a-test-before.json`; a fresh checkout without those snapshots fails safely rather than inventing a preservation baseline. New demonstration records are allowed, but missing or modified original records fail verification.

Local HTTP backend/frontend launch:

```powershell
$env:NODE_ENV = 'development'
$env:ENABLE_LOCAL_MANAGEMENT = 'true'
$env:AUTH_COOKIE_SECURE = 'false' # localhost HTTP exception only
npm run dev
```

Use the registration form to create your own account, then sign in. The independent worker still uses its original explicit opt-in and needs no account/password. Existing PowerShell examples without session cookies/CSRF now correctly receive 401/403; use the dashboard or establish an authenticated cookie session and pass its CSRF header rather than disabling checks. Neither original monitoring nor scheduling demo is an authentication bypass.

## Final verification and remaining limitations

Final checks actually executed on 2026-10-25:

| Check | Result |
| --- | --- |
| `npm test` API | 243 passed in 12 files; 0 failed or skipped |
| `npm test` frontend | 48 passed; 0 failed or skipped |
| Combined automated suite | **291 passed, 0 failed, 0 skipped** |
| `npm run test:db` | **27 passed, 0 failed, 0 skipped**; subset of the backend suite |
| Opted-in `npm run test:e2e` | **3 passed, 0 failed, 0 skipped**, 44.0 seconds in the final full run |
| `npm run typecheck` | Both workspaces passed |
| `npm run build` | Both production builds passed |
| `npm run db:validate` and client generation | Passed; all three approved migrations applied |
| Offline Prisma schema-to-schema SQL diff | Matches intended model additions; no database/shadow database used |
| `npm run db:auth:plan` | Exact local targets, migration history/checksums and authentication schema verified |
| `npm run db:auth:verify` | All 40 original development rows hash-identical; legacy owners remain NULL |
| Live authenticated browser/worker workflow | Passed against actual API, PostgreSQL and HTTPS provider |
| `git diff --check` | Passed |

An early password-hash test incorrectly assumed an ordering of encoded Argon2 parameters; it checks the parameter set and real verification instead. Before migration, the checkpoint had 264 passing and 27 skipped tests; those skips are now resolved. No skipped or unrun test is counted as passed.

The automated suite uses in-memory authentication repositories and mocked frontend responses for unit tests, with **actual Argon2** hashing/verification. It covers registration/duplicates, wrong and missing users, rate limiting, random/hashed/rotated sessions, controlled expiry, logout invalidation, missing/forged cookies and bearer headers, CSRF, HTTP Origin/content-type guards, every cross-user endpoint operation, unclaimed data isolation, owner assignment/filtering, session restoration, registration/login/logout errors and frontend expiry handling. Existing monitoring/fetcher/worker tests also pass.

All **27 PostgreSQL tests ran and passed**: 22 existing persistence/coordination tests and 5 new authentication integration tests. No suite falls back to development. Tests create unique records only in the explicitly confirmed `watchtower_test`, then delete only their own records in foreign-key-safe order. Coverage includes actual user/session persistence, duplicate password preservation, cross-user REST refusal, persisted expiry and internal scheduled execution after logout. Final read-only inspection found the isolated test database empty of suite-owned users, sessions and monitoring records.

Three real browser workflows passed against the compiled API and Vite proxy:

- **Authentication/isolation:** two fresh accounts registered through the UI; HttpOnly/SameSite/local-HTTP cookie behavior, no browser-storage credentials, session restoration, logout/revoked-cookie refusal, all cross-user endpoint/history/check/baseline/schedule operations, every legacy UUID refused to both users, and missing/invalid/other-user CSRF refusal. A Node-only test helper shortened exactly one newly created demo session to one second, scoped by token digest, owning user and recent creation time. Actual HTTP requests then returned 401 and the UI returned to sign-in. It does not change production expiry policy, global clocks or monitoring records.
- **Dashboard:** real registration/check/capture/comparison/history persistence, refresh, dialog Escape/focus and mobile overflow checks. Screenshots contain actual results.
- **Scheduling:** disabled due work stayed unexecuted across more than two normal polls. A due schedule was then enabled with the worker stopped, the browser logged out, and a new worker process committed a real HTTPS check before browser login resumed. Unauthenticated management remained refused. The UI loaded persisted results, and settings survived reload/new-context login. Demonstration schedules were disabled and owned workers stopped afterward.

Earlier browser runs exposed an isolated Playwright request-cookie jar (fixed by using `page.request`) and a real public-provider timeout. The failed check remains stored as `network_error/timeout`; it was never changed into a success. The dashboard test now verifies such a saved failure and permits at most one fresh manual attempt, retaining every attempt and keeping the 8-second deadline and all fetch protections. The final full browser run passed all three workflows without a timeout. A filtered root npm invocation initially selected no tests; the corrected workspace command ran the target successfully.

The verification sequence paused at each failure before advancing stages. Browser verification used fresh compiled API processes for complete runs, with the original 10-login/15-minute process-local limit unchanged; resets across process restarts remain the documented rate-limiter limitation. No auth bypass, mocked live response, relaxed timeout or expanded destination was used.

Final development state: **17 endpoints, 38 actual checks, 0 schema changes, 6 disabled schedule rows, 7 scheduled provenance rows, and 9 unclaimed legacy endpoints**. The original 9 endpoints, 22 checks, 4 schedules and 5 provenance rows are unchanged. Test runs, including failed attempts, left 9 genuine generated development accounts and their real history; none was seeded or assigned old records. Completed workflows log out. Three sessions from interrupted earlier test contexts remain subject to normal eight-hour expiry; no unrelated session was deleted. Workers and verification API/frontend processes were stopped at completion.

Generated screenshots (ignored): `apps/web/artifacts/authentication-desktop.png`, `authentication-mobile.png`, `dashboard-detail.png`, `dashboard-mobile.png`, `scheduling-desktop.png` and `scheduling-mobile.png`. Sign in with your own registered account to create a screenshot-ready workflow; new users correctly do not inherit verification or legacy records.

Phase 6A migration, integration and live verification are complete. Email verification, password reset, MFA, notifications, user deletion, shared rate-limit infrastructure and a production security review remain outside this phase. Only the original two exact public URLs are supported. Legacy claiming still needs separately approved mapping. No public deployment or Phase 6B work has started.

## File inventory for Phase 6A

Created:

- `apps/api/src/auth/auth-repository.ts`, `auth-service.ts`, `auth-routes.ts`
- `apps/api/prisma/migrations/20261025150000_add_authentication_ownership/migration.sql`
- `apps/api/scripts/authentication-plan.ts`
- `apps/api/scripts/authentication-migration.ts`, `verify-authentication-preservation.ts`
- `apps/api/tests/authentication.test.ts`, `ownership.test.ts`, `authentication.integration.test.ts`
- `apps/api/tests/helpers/auth-fixture.ts`, `authenticated-request.ts`, `auth-schema-ready.ts`
- `apps/web/src/components/Authentication.tsx`, `apps/web/tests/authentication.test.tsx`
- `apps/web/e2e/authentication.ts`, `docs/authentication.md`
- `apps/web/e2e/authentication.spec.ts`

Modified:

- Prisma schema; API app/server; monitoring routes/service/repository for user ownership.
- Existing route and database tests; isolated DB test command and read-only schema gates.
- Frontend entry/App/API client/styles/test setup/client expectations; both existing browser workflows.
- Root/API package scripts, lockfile, `.env.example`, `AGENTS.md`, README and relevant documentation.

Existing uncommitted Phase 5B files were preserved; their presence in Git status does not mean they were newly created in Phase 6A.
