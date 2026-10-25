# API Watchtower

**Phase 6B verified for local Mailpit:** all 298 backend tests, 56 frontend tests, 39 PostgreSQL tests and four real browser workflows passed with no final failures or skips. The local HTTP cookie configuration was corrected on the API process; secure defaults and security assertions are unchanged. Read [the final results and evidence](docs/phase6b-final-verification.md) and [notification architecture/setup](docs/notifications.md). Both databases are already migrated; do not reinitialize or reapply migrations. No external mail or public deployment is enabled.

**Phase 6A:** authentication and user isolation are implemented. The approved additive migration was applied to test first, passed all 27 database tests and regressions, then applied to development without changing original monitoring data. All nine legacy endpoints remain unclaimed and invisible to registered users. Read [the authentication design and final verification](docs/authentication.md). `npm run db:auth:plan` performs read-only inspection; do not reinitialize either existing database.

A full-stack API monitoring platform under development. Phases 1–6B provide deterministic schema comparison, PostgreSQL persistence, secure local HTTPS checking, a developer dashboard with persisted monitoring controls, independent monitoring/email workers, session-based authentication with user isolation, and opt-in incident notifications captured by local Mailpit. External email delivery and public deployment are not implemented.

## Structure

```text
apps/
  api/
    prisma/schema.prisma  Endpoint, CheckResult, and SchemaChange models
    scripts/              Guarded disposable database initialization
    src/app.ts            Express application and health route
    src/server.ts         Environment loading and HTTP listener
    src/schema-comparison/ Independent JSON structure comparison and example
    src/database/         Prisma client, repository, safety guards, connectivity CLI
    src/monitoring/       Destination policy, bounded HTTPS fetcher, workflow, local REST routes
    src/scheduling/       Interval and due-time policy
    src/worker/           Independent opt-in process, polling, and safe logging
    tests/                Unit/API tests and isolated PostgreSQL integration tests
  web/
    src/                  React dashboard, API client, reusable components, and styles
    tests/                Test-only fixtures and component/interaction tests
    e2e/                  Explicitly enabled real local browser workflow
    vite.config.ts        React, Tailwind, and development API proxy
```

Npm workspaces share one lockfile and dependency install. The API application is separate from its listener so integration tests can exercise HTTP behavior without starting the development server. Vite proxies `/api` to Express during development, so no CORS dependency is needed. Tailwind v4 uses its Vite plugin and CSS import rather than a legacy configuration file.

Prisma CLI, client, and `@prisma/adapter-pg` use matching 7.10.x versions. `apps/api/prisma.config.ts` loads the database URL and configures schema and migration paths, following the [Prisma configuration reference](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference). Runtime connections use `PrismaPg` with `pg`, following the [official driver adapter documentation](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers). The health route is a process liveness check, not a database readiness check.

## Requirements and installation

- Node.js 22.12+ (Node 24 LTS recommended) and npm 10+.
- PostgreSQL for endpoint data and manual monitoring. Process health and local setup instructions remain available without a database connection.

From the repository root:

```powershell
npm install
if (-not (Test-Path apps/api/.env)) { Copy-Item .env.example apps/api/.env }
$env:NODE_ENV = 'development'
$env:ENABLE_LOCAL_MANAGEMENT = 'true'
$env:AUTH_COOKIE_SECURE = 'false' # localhost HTTP development only
npm run dev
```

Frontend: http://localhost:5173. Backend: http://localhost:3001/api/health.
The health response is `{"status":"ok","service":"api-watchtower"}`.
Stop both with Ctrl+C. To run in separate terminals, use `npm run dev:web` and `npm run dev:api`.

The backend loads `apps/api/.env` because workspace scripts run from that directory. Keep its PORT at 3001 for the default Vite proxy; if you change it, also update the proxy target in `apps/web/vite.config.ts`. Environment files are ignored by Git. Configure your own local credentials; the example contains placeholders only. The API binds to `127.0.0.1` until authentication and authorization exist. Management routes require explicit local-development opt-in; see below.

## Local PostgreSQL setup

See [database setup and persistence verification](docs/database.md) for native PostgreSQL and optional Docker Compose instructions, the baseline representation, safe migration commands, and isolated integration tests.

Local PostgreSQL at `127.0.0.1:5432` has been verified. Migration `20261025094835_init` is applied to `watchtower_dev` and the separately verified disposable `watchtower_test` database. Persistence tests include the manual monitoring workflow. The optional Compose configuration has not been run here. Do not reinitialize either existing database. See the database guide for troubleshooting missing test environment variables.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend and backend together |
| `npm run dev:web` | Start Vite only |
| `npm run dev:api` | Start Express with TypeScript watch mode |
| `npm run dev:worker` | Start the separately opted-in worker (requires approved scheduling migration) |
| `npm run start:worker` | Start the compiled worker with the same opt-in settings |
| `npm run worker:once` | Run one opted-in poll batch, then exit |
| `npm run typecheck` | Check both applications |
| `npm test` | Run all backend and frontend unit/component tests, plus configured DB tests |
| `npm run test:web` | Run frontend component/client tests only |
| `npm run test:e2e` | Opt-in live browser workflow; requires running local stack and WATCHTOWER_LIVE_E2E=true |
| `npm run test:db` | Run only isolated database tests (skipped without TEST_DATABASE_URL) |
| `npm run build` | Build both applications |
| `npm run db:validate` | Validate the Prisma schema |
| `npm run db:generate` | Generate Prisma Client from the models |
| `npm run db:verify` | Verify DATABASE_URL with an actual SELECT 1 query |
| `npm run db:migrate` | Create/apply initial migration in a confirmed empty local development DB |
| `npm run db:prepare-test` | Apply that migration to a confirmed empty local test DB |
| `npm run db:schedule:plan` | Read-only scheduling migration/history/row-count review |
| `npm run db:schedule:apply -- test` | Apply the approved additive migration to the isolated test DB |
| `npm run db:schedule:apply -- development` | Apply the approved additive migration to local development |

After building, `npm run start -w @watchtower/api` starts the compiled API. `npm run preview -w @watchtower/web` previews the frontend build only; the development proxy does not apply to preview. Production routing and deployment configuration are outside the current scope.

Tests cover health, schema comparison, database safety, baseline handling, HTTPS restrictions, authentication/ownership, scheduling, PostgreSQL persistence, and frontend interactions. The 27 PostgreSQL integration tests skip without `TEST_DATABASE_URL` or the approved schema; they never fall back to `DATABASE_URL`. All 27 ran and passed locally. Client generation runs before API development startup, API tests, typechecking, and builds. Component tests mock API responses; three opted-in browser workflows use actual local API/database records and public HTTPS checks. Final Phase 6A verification: 291 automated tests and 3 browser workflows passed, with zero final failures/skips.

## JSON response-schema comparison (Phase 2)

The engine accepts two parsed JSON values and returns deterministic structural differences. It has no HTTP, database, or external service dependencies. See [the comparison policy and limitations](docs/schema-comparison.md) for array inference, optional fields, result types, and usage.

Run the supplied example from the repository root:

```powershell
npm exec -w @watchtower/api -- tsx src/schema-comparison/comparison-example.ts
```

## Manual local monitoring (Phase 3B)

See [the monitoring API guide](docs/monitoring-api.md) for routes, schemas, baseline acceptance, SSRF controls, resource limits, and limitations. Only the documented JSONPlaceholder todo/post test URLs are supported. Arbitrary public URL fetching is intentionally unavailable.

With the migrated local database configured, start the API in one PowerShell terminal:

```powershell
$env:NODE_ENV = 'development'
$env:ENABLE_LOCAL_MANAGEMENT = 'true'
$env:AUTH_COOKIE_SECURE = 'false' # localhost HTTP development only
npm run dev:api
```

In another terminal:

```powershell
& .\scripts\demo-monitoring.ps1
```

The PowerShell demo creates actual persistent development records and explicitly accepts a fresh baseline. Those registrations are not automatically scheduled. Production management routes remain disabled.

## Developer dashboard (Phase 4)

Open `http://localhost:5173` with the explicitly enabled local backend. The dashboard provides endpoint registration/listing, manual checks, baseline review and deliberate acceptance, actual persisted history, and field-level structural differences. It uses the existing Vite proxy and local header without weakening the backend's guards. Missing data stays missing; no metrics or monitoring activity are simulated.

See [dashboard setup, architecture, tests, and screenshot instructions](docs/dashboard.md). Desktop/mobile screenshots from live verification are in the ignored `apps/web/artifacts` directory. Do not reinitialize either existing PostgreSQL database to run this dashboard.

## Opt-in monitoring worker (Phase 5A)

See [the worker architecture, additive migration record, commands, limits, and verification](docs/scheduling.md). Migration 20261025121417_add_endpoint_scheduling was approved and applied to test first, then development after the integration tests passed. Existing endpoints stayed disabled; first explicit enablement is immediately due, then follows a 5/15/30/60-minute cadence. Worker and manual checks share PostgreSQL transaction locks and a three-check global capacity limit. Results/provenance/due advancement commit atomically. Scheduled checks never accept a baseline.

The worker requires `NODE_ENV=development` and `ENABLE_SCHEDULER_WORKER=true` in its own terminal. `npm run dev` does not start it. No scheduled monitoring occurs when the worker is stopped. Verification left every schedule disabled and workers stopped. Both existing databases are already migrated; do not use the original initialization script on them.

Final Phase 5A checks: 238 automated tests passed (210 backend, 28 frontend), zero failures/skips; 22 database integration tests passed as a subset. TypeScript, production builds, and Prisma validation passed. Live verification discovered and fixed a non-UTC timestamp decoding issue before final demonstration; historical rows were preserved.
