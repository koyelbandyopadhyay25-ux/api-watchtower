# Working on API Watchtower

API Watchtower detects endpoint failures and JSON response-schema changes.
The current implementation includes the Phase 1 foundation, Phase 2 JSON sample schema comparison engine, and verified Phase 3A persistence layer. Keep comparison logic independent of HTTP and database code. Migration 20261025094835_init is applied to local watchtower_dev and isolated watchtower_test; all five database integration tests passed. Do not rerun initial database preparation on these populated schemas.

- Keep React + Vite + TypeScript in `apps/web` and Express + TypeScript in `apps/api`.
- Use PostgreSQL with Prisma. Keep schema and migrations in `apps/api/prisma`.
- Use npm workspaces and commit the root package-lock.json when committing changes.
- Write readable code suitable for an undergraduate developer. Explain significant architectural decisions.
- Prefer real functionality and minimal dependencies. Never invent monitoring activity or success data.
- Keep the UI compact: warm off-white, charcoal text, thin borders, small radii, restrained colors, functional tables. Avoid gradients, decorative graphics, and excessive animation.
- Never commit credentials or local .env files. Update .env.example when configuration changes.
- Use Prisma 7 with @prisma/adapter-pg. Generate the client before TypeScript checks and builds; generated files are ignored.
- Store structural baselines and safe error categories only, never full responses, request credentials, or raw exception messages. Baseline replacement must always be explicit.
- Keep the API bound to localhost until authentication and authorization exist. No database management HTTP routes are currently exposed.
- Database integration tests must use a separately confirmed local watchtower_test database, never DATABASE_URL. Do not truncate, reset, or delete unrelated records.
- Initial migration creation requires a confirmed empty disposable local watchtower_dev database. Use the guarded db:migrate command. Do not use reset or force flags.
- Work incrementally. Run `npm run typecheck`, `npm test`, and `npm run build` for relevant changes; report only checks actually executed.
- Ask before deploying, publishing, or performing destructive operations.
- Do not add monitoring, authentication, dashboard features, or deployment without a subsequent request.
