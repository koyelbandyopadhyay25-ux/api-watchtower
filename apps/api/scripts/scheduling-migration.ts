import 'dotenv/config';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createDatabaseClient } from '../src/database/database-client.js';

const initial = '20261025094835_init';
const migration = '20261025121417_add_endpoint_scheduling';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
class MigrationSafetyError extends Error {}

async function inspect(purpose: 'development' | 'test') {
  const connectionString = purpose === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (process.env.NODE_ENV === 'production' || !connectionString ||
      (purpose === 'test' && process.env.TEST_DATABASE_DISPOSABLE !== 'true')) {
    throw new MigrationSafetyError('A configured local target and confirmed disposable test database are required.');
  }
  const url = new URL(connectionString);
  const database = purpose === 'test' ? 'watchtower_test' : 'watchtower_dev';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== `/${database}` ||
      [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) {
    throw new MigrationSafetyError('Migration target must be the exact dedicated local database and public schema.');
  }
  const files = readdirSync('prisma/migrations', { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (JSON.stringify(files) !== JSON.stringify([initial, migration])) throw new MigrationSafetyError('Unexpected local migrations. Review them before applying changes.');
  const client = createDatabaseClient(connectionString);
  try {
    const snapshot = await client.$transaction(async transaction => {
      await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
      const identity = await transaction.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
      if (identity[0]?.name !== database) throw new MigrationSafetyError('Unexpected actual database identity.');
      const applied = await transaction.$queryRaw<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
        SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at
      `;
      if (applied.length < 1 || applied.length > 2 || applied.some(row => ![initial, migration].includes(row.migration_name) || !row.finished_at || row.rolled_back_at)) {
        throw new MigrationSafetyError('Unexpected or unfinished migration history. No repair/reset will be attempted.');
      }
      const original = applied.find(row => row.migration_name === initial);
      if (!original) throw new MigrationSafetyError('The completed initial migration is required.');
      for (const row of applied) {
        const text = readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`, 'utf8');
        const lf = text.replace(/\r\n/g, '\n');
        if (![text, lf, lf.replace(/\n/g, '\r\n')].some(candidate => hash(candidate) === row.checksum)) {
          throw new MigrationSafetyError('An applied migration differs from its local file. No changes attempted.');
        }
      }
      const counts = await transaction.$queryRaw<{ endpoints: number; checks: number; changes: number }[]>`
        SELECT (SELECT count(*)::int FROM "Endpoint") AS endpoints,
               (SELECT count(*)::int FROM "CheckResult") AS checks,
               (SELECT count(*)::int FROM "SchemaChange") AS changes
      `;
      const tables = await transaction.$queryRaw<{ name: string }[]>`
        SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'
      `;
      const exists = tables.some(table => table.name === 'EndpointSchedule' || table.name === 'ScheduledCheck');
      const complete = applied.some(row => row.migration_name === migration);
      if (exists && !complete) throw new MigrationSafetyError('Scheduling tables exist without a completed migration. Review manually.');
      return { database, complete, counts: counts[0], applied: applied.map(row => row.migration_name) };
    });
    return { connectionString, snapshot };
  } finally { await client.$disconnect(); }
}

async function main() {
  const mode = process.argv[2];
  const purpose = process.argv[3];
  if (mode !== 'plan' && mode !== 'apply') throw new MigrationSafetyError('Use plan or apply.');
  if (mode === 'apply' && (process.env.SCHEDULING_MIGRATION_APPROVED !== 'true' || !['development', 'test'].includes(purpose ?? ''))) {
    throw new MigrationSafetyError('Application requires explicit approval, SCHEDULING_MIGRATION_APPROVED=true, and a development/test target.');
  }
  const targets = purpose === 'development' || purpose === 'test' ? [purpose] as const : ['test', 'development'] as const;
  for (const target of targets) {
    const before = await inspect(target);
    console.log(JSON.stringify({ mode, ...before.snapshot, migration, sha256: hash(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8')) }, null, 2));
    if (mode === 'plan' || before.snapshot.complete) continue;
    const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
    const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: before.connectionString } });
    if (result.status !== 0) throw new MigrationSafetyError('Forward migration failed. No reset or automatic repair attempted.');
    const after = await inspect(target);
    if (!after.snapshot.complete) throw new MigrationSafetyError('Migration completion could not be verified.');
    console.log(JSON.stringify({ verified: true, ...after.snapshot }, null, 2));
  }
}

main().catch(error => {
  console.error(error instanceof MigrationSafetyError ? error.message : 'Migration inspection/application failed. Check the local database; credentials are not logged.');
  process.exitCode = 1;
});
