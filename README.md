# API Watchtower

A full-stack API monitoring platform under development. The Phase 1 foundation and Phase 2 JSON sample schema comparison engine are implemented. Monitoring, authentication, and dashboard features are not implemented.

## Structure

```text
apps/
  api/
    prisma/schema.prisma  PostgreSQL datasource; no domain models yet
    src/app.ts            Express application and health route
    src/server.ts         Environment loading and HTTP listener
    src/schema-comparison/ Independent JSON structure comparison and example
    tests/                Vitest health and schema comparison tests
  web/
    src/                  React setup page and Tailwind styles
    vite.config.ts        React, Tailwind, and development API proxy
```

Npm workspaces share one lockfile and dependency install. The API application is separate from its listener so integration tests can exercise HTTP behavior without starting the development server. Vite proxies `/api` to Express during development, so no CORS dependency is needed. Tailwind v4 uses its Vite plugin and CSS import rather than a legacy configuration file.

Prisma CLI and client use matching 7.10.x versions. `apps/api/prisma.config.ts` loads the database URL and configures schema and migration paths, following the [Prisma configuration reference](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference). There are deliberately no domain models or migrations before the monitoring data model is designed. The health route is a process liveness check, not a database readiness check. A PostgreSQL driver adapter will be added when database queries are implemented.

## Requirements and installation

- Node.js 22.12+ (Node 24 LTS recommended) and npm 10+.
- PostgreSQL for future database-backed work. The setup page and health route run without it.

From the repository root:

```powershell
npm install
Copy-Item .env.example apps/api/.env
npm run dev
```

Frontend: http://localhost:5173. Backend: http://localhost:3001/api/health.
The health response is `{"status":"ok","service":"api-watchtower"}`.
Stop both with Ctrl+C. To run in separate terminals, use `npm run dev:web` and `npm run dev:api`.

The backend loads `apps/api/.env` because workspace scripts run from that directory. Keep its PORT at 3001 for the default Vite proxy; if you change it, also update the proxy target in `apps/web/vite.config.ts`. Environment files are ignored by Git. The example contains local development credentials only.

## Local PostgreSQL setup

Install and start PostgreSQL locally. Open `psql` as your PostgreSQL administrator and run these once:

```sql
CREATE ROLE watchtower WITH LOGIN PASSWORD 'watchtower_dev' CREATEDB;
CREATE DATABASE watchtower OWNER watchtower;
```

Use a dedicated local development role: `CREATEDB` lets Prisma Migrate create its shadow database and must not be copied into production access policies. Update `apps/api/.env` if your local username, password, port, or database differs. URL-encode special characters in connection credentials.

```powershell
npm run db:validate
```

Validation checks schema syntax and environment configuration; it does not connect to PostgreSQL. After domain models are introduced in a later phase, run `npm run db:generate` to generate the client and `npm run db:migrate -- --name init` to create and apply the initial migration. Client generation and migration creation are deferred while the schema has no models. Review migration SQL and use a development database. Commit future migration files, never database data or credentials.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend and backend together |
| `npm run dev:web` | Start Vite only |
| `npm run dev:api` | Start Express with TypeScript watch mode |
| `npm run typecheck` | Check both applications |
| `npm test` | Run API integration tests with Vitest |
| `npm run build` | Build both applications |
| `npm run db:validate` | Validate the Prisma schema |
| `npm run db:generate` | Generate Prisma client after adding models |
| `npm run db:migrate -- --name init` | Create a development migration after adding models |

After building, `npm run start -w @watchtower/api` starts the compiled API. `npm run preview -w @watchtower/web` previews the frontend build only; the development proxy does not apply to preview. Production routing and deployment configuration are outside Phase 1.

API tests verify the health response, unknown-route behavior, and schema comparison logic. Frontend validation currently consists of TypeScript checking and a production build; there is no frontend test suite yet.

## JSON response-schema comparison (Phase 2)

The engine accepts two parsed JSON values and returns deterministic structural differences. It has no HTTP, database, or external service dependencies. See [the comparison policy and limitations](docs/schema-comparison.md) for array inference, optional fields, result types, and usage.

Run the supplied example from the repository root:

```powershell
npm exec -w @watchtower/api -- tsx src/schema-comparison/comparison-example.ts
```
