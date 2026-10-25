import 'dotenv/config';
import { createDatabaseClient } from '../../src/database/database-client.js';
import { assertDisposableDatabase } from '../../src/database/disposable-database.js';

/** Read-only gate: never run integration writes against a pending schema. */
export async function authSchemaReady() {
  if (!process.env.TEST_DATABASE_URL) return false;
  const url = assertDisposableDatabase(process.env.TEST_DATABASE_URL, 'test', process.env.TEST_DATABASE_DISPOSABLE);
  const client = createDatabaseClient(url);
  try {
    const rows = await client.$queryRaw<{ applied: boolean; columns: number }[]>`
      SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261025150000_add_authentication_ownership'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public'
          AND ((table_name = 'Endpoint' AND column_name = 'ownerId') OR (table_name IN ('User', 'Session') AND column_name IN ('id', 'tokenHash')))) AS columns
    `;
    if (!rows[0]?.applied && rows[0]?.columns === 0) return false;
    if (!rows[0]?.applied || rows[0]?.columns !== 3) throw new Error('Partial authentication schema: stop and inspect migration state.');
    return true;
  } finally { await client.$disconnect(); }
}
