# Working on API Watchtower

API Watchtower detects endpoint failures and JSON response-schema changes.
The current implementation includes Phases 1–5A: foundation, schema comparison, PostgreSQL persistence, secure HTTPS monitoring, the developer dashboard, and a separately opted-in scheduling worker. Keep comparison logic independent of HTTP and database code. Migrations 20261025094835_init and 20261025121417_add_endpoint_scheduling are applied to local watchtower_dev and isolated watchtower_test. Do not rerun initial database preparation on these populated schemas.

- Keep React + Vite + TypeScript in `apps/web` and Express + TypeScript in `apps/api`.
- Use PostgreSQL with Prisma. Keep schema and migrations in `apps/api/prisma`.
- Use npm workspaces and commit the root package-lock.json when committing changes.
- Write readable code suitable for an undergraduate developer. Explain significant architectural decisions.
- Prefer real functionality and minimal dependencies. Never invent monitoring activity or success data.
- Keep the UI compact: warm off-white, charcoal text, thin borders, small radii, restrained colors, functional tables. Avoid gradients, decorative graphics, and excessive animation.
- Never commit credentials or local .env files. Update .env.example when configuration changes.
- Use Prisma 7 with @prisma/adapter-pg. Generate the client before TypeScript checks and builds; generated files are ignored.
- Store structural baselines and safe error categories only, never full responses, request credentials, or raw exception messages. Baseline replacement must always be explicit.
- Keep the API bound to localhost until authentication and authorization exist. Management routes require NODE_ENV=development and ENABLE_LOCAL_MANAGEMENT=true, a loopback peer/Host, an allowed Origin if supplied, and X-Watchtower-Local: 1. Never enable them publicly.
- Keep the exact public test allowlist, IPv4-only validated IP dialing, hostname TLS verification, redirect refusal, and resource limits. Do not add arbitrary URL fetching or weaken controls to make an upstream request succeed. Read docs/monitoring-api.md before changing the workflow.
- Database integration tests must use a separately confirmed local watchtower_test database, never DATABASE_URL. Do not truncate, reset, or delete unrelated records.
- Initial migration creation requires a confirmed empty disposable local watchtower_dev database. Use the guarded db:migrate command. Do not use reset or force flags.
- Work incrementally. Run `npm run typecheck`, `npm test`, and `npm run build` for relevant changes; report only checks actually executed.
- Frontend requests must use the same-origin Vite /api proxy and required X-Watchtower-Local header, without credentials. Do not bundle Prisma, database credentials, or test fixtures in the frontend. Read docs/dashboard.md before changing data-loading or baseline confirmation behavior.
- npm test runs both workspaces. Frontend component tests mock API data; the WATCHTOWER_LIVE_E2E=true browser test makes actual public requests and leaves real development history. Never create fake runtime metrics or incidents for screenshots.
- Ask before deploying, publishing, or performing destructive operations.
- Do not add monitoring, authentication, dashboard features, or deployment without a subsequent request.
- The Phase 5A migration was explicitly approved, applied to test first, tested, then applied to development. Worker persistence, stopped-worker inactivity, and restart recovery are verified. All schedules were left disabled and verification workers stopped. Future migrations still require review/approval; never rerun initialization/reset.
- Keep application PostgreSQL sessions in UTC and scheduling-clock reads based on epoch milliseconds. Raw timestamptz decoding under a non-UTC server default caused a live verification offset; regression tests now cover this. Do not rewrite historical timestamps or original monitoring rows without explicit authorization.
- All manual, baseline, and scheduled checks must retain the shared PostgreSQL transaction locks/global capacity and original secure fetcher. Worker opt-in is separate (ENABLE_SCHEDULER_WORKER=true plus NODE_ENV=development); endpoint opt-in defaults disabled. Never automatically accept baselines or claim a stopped worker is monitoring.
