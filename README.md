# API Watchtower

A full-stack API monitoring platform under development. The Phase 1 foundation, Phase 2 JSON sample schema comparison engine, and Phase 3A persistence layer are implemented. Local PostgreSQL migration and persistence integration tests have been verified. Monitoring, authentication, and dashboard features are not implemented.

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
    tests/                Unit/API tests and isolated PostgreSQL integration tests
  web/
    src/                  React setup page and Tailwind styles
    vite.config.ts        React, Tailwind, and development API proxy
```

Npm workspaces share one lockfile and dependency install. The API application is separate from its listener so integration tests can exercise HTTP behavior without starting the development server. Vite proxies `/api` to Express during development, so no CORS dependency is needed. Tailwind v4 uses its Vite plugin and CSS import rather than a legacy configuration file.

Prisma CLI, client, and `@prisma/adapter-pg` use matching 7.10.x versions. `apps/api/prisma.config.ts` loads the database URL and configures schema and migration paths, following the [Prisma configuration reference](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference). Runtime connections use `PrismaPg` with `pg`, following the [official driver adapter documentation](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers). The health route is a process liveness check, not a database readiness check.

## Requirements and installation

- Node.js 22.12+ (Node 24 LTS recommended) and npm 10+.
- PostgreSQL for future database-backed work. The setup page and health route run without it.

From the repository root:

```powershell
npm install
if (-not (Test-Path apps/api/.env)) { Copy-Item .env.example apps/api/.env }
npm run dev
```

Frontend: http://localhost:5173. Backend: http://localhost:3001/api/health.
The health response is `{"status":"ok","service":"api-watchtower"}`.
Stop both with Ctrl+C. To run in separate terminals, use `npm run dev:web` and `npm run dev:api`.

The backend loads `apps/api/.env` because workspace scripts run from that directory. Keep its PORT at 3001 for the default Vite proxy; if you change it, also update the proxy target in `apps/web/vite.config.ts`. Environment files are ignored by Git. Configure your own local credentials; the example contains placeholders only. The API binds to `127.0.0.1` until authentication and authorization exist. There are no database management HTTP routes.

## Local PostgreSQL setup

See [database setup and persistence verification](docs/database.md) for native PostgreSQL and optional Docker Compose instructions, the baseline representation, safe migration commands, and isolated integration tests.

Local PostgreSQL at `127.0.0.1:5432` has been verified. Migration `20261025094835_init` is applied to `watchtower_dev` and the separately verified disposable `watchtower_test` database. All five PostgreSQL integration tests passed; the full suite passed 55 tests with none skipped. The optional Compose configuration has not been run here. See the database guide for troubleshooting missing test environment variables.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend and backend together |
| `npm run dev:web` | Start Vite only |
| `npm run dev:api` | Start Express with TypeScript watch mode |
| `npm run typecheck` | Check both applications |
| `npm test` | Run health, comparison, safety, and configured database tests |
| `npm run test:db` | Run only isolated database tests (skipped without TEST_DATABASE_URL) |
| `npm run build` | Build both applications |
| `npm run db:validate` | Validate the Prisma schema |
| `npm run db:generate` | Generate Prisma Client from the models |
| `npm run db:verify` | Verify DATABASE_URL with an actual SELECT 1 query |
| `npm run db:migrate` | Create/apply initial migration in a confirmed empty local development DB |
| `npm run db:prepare-test` | Apply that migration to a confirmed empty local test DB |

After building, `npm run start -w @watchtower/api` starts the compiled API. `npm run preview -w @watchtower/web` previews the frontend build only; the development proxy does not apply to preview. Production routing and deployment configuration are outside Phase 1.

Tests cover the health route, comparison logic, database safety guards, baseline validation, and safe error handling. Five PostgreSQL integration tests are skipped without `TEST_DATABASE_URL`; they never fall back to `DATABASE_URL`. Client generation runs before tests, typechecking, and builds. Frontend validation consists of TypeScript checking and a production build; there is no frontend test suite yet.

## JSON response-schema comparison (Phase 2)

The engine accepts two parsed JSON values and returns deterministic structural differences. It has no HTTP, database, or external service dependencies. See [the comparison policy and limitations](docs/schema-comparison.md) for array inference, optional fields, result types, and usage.

Run the supplied example from the repository root:

```powershell
npm exec -w @watchtower/api -- tsx src/schema-comparison/comparison-example.ts
```
