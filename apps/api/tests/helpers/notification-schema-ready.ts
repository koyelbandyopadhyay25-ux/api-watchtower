import 'dotenv/config';
import { createDatabaseClient } from '../../src/database/database-client.js';
import { assertDisposableDatabase } from '../../src/database/disposable-database.js';

export async function notificationSchemaReady() {
  if (!process.env.TEST_DATABASE_URL) return false;
  const client = createDatabaseClient(assertDisposableDatabase(process.env.TEST_DATABASE_URL, 'test', process.env.TEST_DATABASE_DISPOSABLE));
  try {
    const rows = await client.$queryRaw<{ applied: boolean; tables: number }[]>`
      SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='20261025160000_add_notification_outbox'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
        (SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND tablename IN ('NotificationPreference','Incident','NotificationEvent','EmailOutbox','EmailAttempt')) AS tables
    `;
    if (!rows[0]?.applied && rows[0]?.tables === 0) return false;
    if (!rows[0]?.applied || rows[0]?.tables !== 5) throw new Error('Partial notification schema. Stop and inspect migration state.');
    return true;
  } finally { await client.$disconnect(); }
}
