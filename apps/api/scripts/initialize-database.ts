import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createDatabaseClient } from '../src/database/database-client.js';
import { assertDisposableDatabase, DatabaseSafetyError } from '../src/database/disposable-database.js';

async function main() {
  const purpose = process.argv[2];
  if (purpose !== 'development' && purpose !== 'test') throw new DatabaseSafetyError('Invalid purpose.');
  const test = purpose === 'test';
  const connectionString = assertDisposableDatabase(
    test ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL,
    purpose,
    test ? process.env.TEST_DATABASE_DISPOSABLE : process.env.DEV_DATABASE_DISPOSABLE,
  );
  const migrationsExist = existsSync('prisma/migrations') &&
    readdirSync('prisma/migrations', { recursive: true }).some(path => String(path).endsWith('migration.sql'));
  if (test && !migrationsExist) {
    throw new DatabaseSafetyError('Create the development migration before preparing the test database.');
  }
  if (!test && migrationsExist) {
    throw new DatabaseSafetyError('The initial migration already exists. Review future migration work separately.');
  }
  const client = createDatabaseClient(connectionString);
  try {
    const identity = await client.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    const expected = test ? 'watchtower_test' : 'watchtower_dev';
    if (identity[0]?.name !== expected) throw new DatabaseSafetyError('Unexpected database identity.');
    const relations = await client.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT LIKE 'pg_%'
        AND namespace.nspname <> 'information_schema'
    `;
    if (relations[0]?.count !== 0) {
      throw new DatabaseSafetyError('Database is not empty. Refusing to migrate, reset, or overwrite existing data.');
    }
  } finally {
    await client.$disconnect();
  }

  // No shell interpolation, reset command, data-loss flag, or credentials in output.
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const args = test ? ['migrate', 'deploy'] : ['migrate', 'dev', '--name', 'init'];
  const result = spawnSync(process.execPath, [cli, ...args], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  if (result.status !== 0) throw new DatabaseSafetyError('Migration command did not succeed.');
}

main().catch(error => {
  // Only our static validation errors are actionable; do not dump driver errors.
  console.error(error instanceof DatabaseSafetyError
    ? error.message
    : 'Database initialization failed. Check the local server and configuration. No credentials are logged.');
  process.exitCode = 1;
});
