# Local database and persistence (Phase 3A)

Phase 6B adds five incident/notification/outbox tables, with no backfill or old-table column changes. The explicitly approved migration is already applied to both local databases. Do not rerun initialization or migrations. See [notification architecture](notifications.md) and [verification and preservation evidence](phase6b-final-verification.md).

**Phase 6A verified:** the explicitly approved [authentication migration](authentication.md) is applied to both local databases, test first after all 27 integration tests passed. The nullable owner column and User/Session tables preserve original monitoring rows; all nine legacy endpoints remain unclaimed. Read-only `npm run db:auth:plan` verifies both targets. Do not rerun initial preparation or migration application.

## Current verification status

Local PostgreSQL connectivity has been verified at `127.0.0.1:5432`. Both databases have completed migrations `20261025094835_init` and `20261025121417_add_endpoint_scheduling`. The additive scheduling migration was explicitly approved, applied to test first, tested, then applied to development. The original 3 development endpoints and 9 checks were verified unchanged by per-row content hashes. See [the migration and worker verification record](scheduling.md). Do not prepare/reset either existing database. The optional Docker Compose configuration has not been exercised.

## Models and data boundaries

- `Endpoint`: UUID, name, URL, nullable JSONB baseline, created/updated timestamps.
- `CheckResult`: UUID, endpoint foreign key, nullable HTTP status and elapsed milliseconds, outcome, nullable safe error category, and check timestamp. A composite `(endpointId, checkedAt)` index supports endpoint history.
- `SchemaChange`: UUID, check foreign key, path, change kind, previous/current type arrays. The check foreign key is indexed.

Endpoint deletion is restricted while checks exist, protecting history from accidental deletion. Check deletion cascades to its change rows. No deletion operation is exposed by the repository or API. Integration tests remove only records they created.

The repository supports creating/retrieving endpoints, explicitly setting/clearing baselines, atomically recording checks with changes, and retrieving bounded history. It does not fetch URLs or schedule work. Connection pools are owned by callers; always disconnect in `finally`. Safe `DatabaseError` codes are `not_found`, `conflict`, `unavailable`, and `operation_failed`; raw driver exceptions are not propagated or logged. Absence from `getEndpoint`/`getCheckResult` returns null.

No response-body or request-header column exists. Errors use a fixed enum rather than free-text messages. URLs with embedded credentials, query strings, or fragments are rejected. Avoid secrets or personal data in endpoint names, URL paths, or JSON property names: structural field paths are persisted. Phase 6A adds authentication and endpoint ownership; the API remains explicitly enabled local-development-only and bound to IPv4 localhost. See [the monitoring API guide](monitoring-api.md) and [authentication storage design](authentication.md).

## Baselines

`baselineSchema` starts as SQL NULL, meaning no baseline has been approved. JSON null as a response type is represented by `{ "types": ["null"] }`, distinct from no baseline.

The baseline format contains structure only:

```json
{
  "types": ["object"],
  "properties": {
    "id": { "types": ["number"] },
    "products": {
      "types": ["array"],
      "items": { "types": ["object"], "properties": { "price": { "types": ["number"] } } }
    }
  }
}
```

Allowed types match the Phase 2 engine. `properties` is valid only with an object type; `items` only with an array type. Omitting `items` represents unknown item structure, such as an empty sampled array. Extra metadata/value fields are rejected, and validation has a nesting limit of 100. Baseline serialization is not a replacement for the Phase 2 comparison algorithm and does not infer structures from bodies.

`repository.setBaseline(endpointId, schema)` explicitly sets/replaces a baseline internally. Passing null explicitly clears it. Recording a check never changes the baseline, even when schema changes are saved. Phase 3B connects inference and comparison through a separate monitoring service; REST acceptance uses `repository.acceptBaseline` with an optimistic `updatedAt` condition. There is no public/internal HTTP route for clearing baselines.

## Configure local environment

From the repository root, create the environment file only if missing:

```powershell
if (-not (Test-Path apps/api/.env)) { Copy-Item .env.example apps/api/.env }
```

Edit `apps/api/.env`. Preserve any existing settings. Choose a local password, replace the password placeholder in `POSTGRES_PASSWORD` and `DATABASE_URL`, and URL-encode special characters within URLs. Do not commit this file. Use database names `watchtower_dev` and `watchtower_test` for the guarded commands.

Keep `DEV_DATABASE_DISPOSABLE=false` and `TEST_DATABASE_DISPOSABLE=false` until you have personally confirmed that the respective databases are dedicated to this project and disposable. The guards also require localhost, exact database names, the public schema, and a non-production Node environment. They cannot prove a database contains no important information merely from its name.

## Option A: native PostgreSQL

Install PostgreSQL 17 with its command-line tools, start the local service, and restrict TCP listening to localhost (`listen_addresses = 'localhost'`). Do not configure public listeners or remote access rules. Connect using `psql -U postgres -h 127.0.0.1 -d postgres` and run these once only if the role/databases do not already exist:

```sql
CREATE ROLE watchtower LOGIN CREATEDB;
\password watchtower
CREATE DATABASE watchtower_dev OWNER watchtower;
CREATE DATABASE watchtower_test OWNER watchtower;
```

`\password` prompts for your chosen password without putting it into the SQL command. `CREATEDB` is for this local development role only: Prisma Migrate Dev needs a shadow database. Use port 5432 for both databases with this native setup; use database names to isolate them. If either database already exists, inspect it before proceeding and never reset or reuse it blindly.

## Option B: Docker Desktop (not installed or exercised here)

Install/start Docker Desktop with Linux containers and Compose support. `compose.yaml` provides development and optional test services with separate volumes; ports are bound to `127.0.0.1` only. With your local password configured:

```powershell
docker compose --env-file apps/api/.env up -d postgres
docker compose --env-file apps/api/.env --profile test up -d postgres-test
docker compose --env-file apps/api/.env --profile test ps
```

Development uses port 5432; the separate test service uses port 5433. Both use the `watchtower` role. The PostgreSQL image creates the specified role/database only when its data volume is new. Changing environment variables will not change credentials in an existing volume. Never delete a volume to work around configuration errors without explicit approval.

## Verify and create the initial migration

Once the development server/database actually exists:

```powershell
npm install
npm run db:validate
npm run db:generate
npm run db:verify
```

`db:verify` runs `SELECT 1` through Prisma's PostgreSQL adapter, exits nonzero on failure, and never prints connection credentials. It checks connectivity, not whether application tables are present. `/api/health` remains process health and never claims database readiness.

After confirming `watchtower_dev` is dedicated, empty, and disposable, set `DEV_DATABASE_DISPOSABLE=true` in the local environment file and run:

```powershell
npm run db:migrate
```

This is an initial-setup command for a fresh checkout/database. It queries the actual database identity and refuses databases containing any non-system relations (including tables, sequences, and views), then runs `prisma migrate dev --name init` without reset or data-loss flags. It also refuses to create a second initial migration. The current development database has already completed `20261025094835_init`: do not rerun initial setup against it. The migration SQL creates the three models, enums, indexes, and foreign keys without drop/reset statements. Commit migration files; generated client files remain ignored. Future schema changes need a separately reviewed migration workflow.

## Isolated integration tests and persistence verification

Set the local `TEST_DATABASE_URL` to a dedicated database:

- Native PostgreSQL: `postgresql://watchtower:YOUR_ENCODED_PASSWORD@127.0.0.1:5432/watchtower_test?schema=public`
- Compose test service: `postgresql://watchtower:YOUR_ENCODED_PASSWORD@127.0.0.1:5433/watchtower_test?schema=public`

After confirming this database is disposable, set `TEST_DATABASE_DISPOSABLE=true`. Create the development migration first, then prepare the initially empty test database once:

```powershell
npm run db:prepare-test
npm run test:db
npm test
npm run typecheck
npm run build
```

`db:prepare-test` verifies the database identity and emptiness, then applies the existing migration with `prisma migrate deploy`. Do not rerun preparation against a populated test database; rerun `test:db` directly. Test execution never creates/drops schemas or resets/truncates tables. It creates uniquely identified records, retrieves a committed endpoint through a second client, tests explicit baseline persistence, check/change storage, safe failures, referential integrity, and delete behavior. Cleanup deletes only the IDs created by that suite. These are synthetic integration-test records, not claimed monitoring activity.

Without `TEST_DATABASE_URL`, database integration tests explicitly skip. With an invalid, unconfirmed, or unreachable test URL, they fail rather than falling back to the application database. The existing-schema suite also tests PostgreSQL coordination across clients and timezone-safe timestamps. All 11 scheduling tests ran after the approved migration; the final database suite passed 22 tests with no skips. They skip on a fresh database without the scheduling migration and fail on a partial schema. Never run these commands against a production database.

Application connections set their own session timezone to UTC, without changing server settings or stored rows. The scheduling clock reads epoch milliseconds rather than timezone-sensitive raw timestamptz text. Regression tests verify behavior with a non-UTC transaction timezone and compare ORM timestamps to database epoch values. Historical timestamp values were not rewritten.

## Troubleshooting: disposable database rejected and tests skipped

The generic error `A confirmed disposable local database is required.` means at least one of these checks failed: the URL is present/nonempty, the relevant disposable flag equals exactly `true`, or `NODE_ENV` is not `production`. Setting the flag alone is insufficient.

For test preparation, both `TEST_DATABASE_URL` and `TEST_DATABASE_DISPOSABLE=true` must be available to the API workspace. In the diagnosed configuration, **both variables were absent** from `apps/api/.env` and the inherited environment. Only `DATABASE_URL` was configured, and it correctly targeted `watchtower_dev`. This also explained why all five database tests skipped: the suite explicitly skips when `TEST_DATABASE_URL` is missing or empty.

Update the Git-ignored `apps/api/.env`, preserving existing credentials and development settings. Add a test URL targeting the confirmed disposable `watchtower_test` database on localhost and set `TEST_DATABASE_DISPOSABLE=true`. For the verified native installation, the port is 5432; port 5433 applies only to the optional separate Compose test service. Never point `TEST_DATABASE_URL` at `watchtower_dev`, and never copy connection strings or passwords into shared logs.

Npm workspace scripts execute from `apps/api`, so `dotenv/config` loads `apps/api/.env`, not a root environment file. Environment variables inherited from the shell take precedence over that file. A flag set in a different terminal is not automatically available to another terminal or agent session. Keep the two test settings in the local file for consistent future runs. No guard changes or bypasses are needed.

## Next phase

Both migrations and scheduling persistence are verified. Manual HTTPS checks and baseline capture work with the Phase 4 dashboard; Phase 5A reuses those checks in a separate opt-in worker. Authentication, alerts, dashboard schedule controls, and public deployment remain future work.
