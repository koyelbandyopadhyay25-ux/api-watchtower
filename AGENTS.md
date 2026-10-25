# Working on API Watchtower

API Watchtower detects endpoint failures and JSON response-schema changes.
The current implementation includes the Phase 1 foundation and Phase 2 JSON sample schema comparison engine. Keep comparison logic independent of HTTP and database code.

- Keep React + Vite + TypeScript in `apps/web` and Express + TypeScript in `apps/api`.
- Use PostgreSQL with Prisma. Keep schema and migrations in `apps/api/prisma`.
- Use npm workspaces and commit the root package-lock.json when committing changes.
- Write readable code suitable for an undergraduate developer. Explain significant architectural decisions.
- Prefer real functionality and minimal dependencies. Never invent monitoring activity or success data.
- Keep the UI compact: warm off-white, charcoal text, thin borders, small radii, restrained colors, functional tables. Avoid gradients, decorative graphics, and excessive animation.
- Never commit credentials or local .env files. Update .env.example when configuration changes.
- Work incrementally. Run `npm run typecheck`, `npm test`, and `npm run build` for relevant changes; report only checks actually executed.
- Ask before deploying, publishing, or performing destructive operations.
- Do not add monitoring, authentication, dashboard features, or deployment without a subsequent request.
