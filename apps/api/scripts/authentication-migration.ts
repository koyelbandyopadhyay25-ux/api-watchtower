import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const migration = '20261025150000_add_authentication_ownership';
const approvedChecksum = '465808d0077be06540a6a8199357e4bb80c73c43fb5f299009bd0260ac291fd6';
const known = ['20261025094835_init', '20261025121417_add_endpoint_scheduling', migration];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
type Snapshot = Record<string, { count: number; sha256: string; rows: { id: string; sha256: string }[] }>;
class MigrationSafetyError extends Error {}

async function inspect(connectionString: string, expectedName: string) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect(); await client.query('BEGIN READ ONLY');
    const identity = (await client.query('SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
    if (identity.name !== expectedName || identity.host !== '127.0.0.1' || identity.port !== 5432) throw new MigrationSafetyError('Actual database mismatch.');
    const history = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name')).rows;
    const applied = history.length === 3;
    if (JSON.stringify(history.map(row => row.migration_name)) !== JSON.stringify(applied ? known : known.slice(0, 2)) || history.some(row => !row.finished_at || row.rolled_back_at)) throw new MigrationSafetyError('Unexpected migration history.');
    for (const row of history) {
      const sql = readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`, 'utf8').replace(/\r\n/g, '\n');
      if (![sql, sql.replace(/\n/g, '\r\n')].some(text => hash(text) === row.checksum)) throw new MigrationSafetyError('Applied checksum mismatch.');
    }
    const additions = (await client.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND ((table_name='Endpoint' AND column_name='ownerId') OR (table_name='User' AND column_name='id') OR (table_name='Session' AND column_name='tokenHash'))")).rows[0].count;
    if (additions !== (applied ? 3 : 0)) throw new MigrationSafetyError('Partial authentication schema.');
    const snapshot: Snapshot = {};
    for (const [name, key] of [['Endpoint', 'id'], ['CheckResult', 'id'], ['SchemaChange', 'id'], ['EndpointSchedule', 'endpointId'], ['ScheduledCheck', 'checkResultId']] as const) {
      const rows = (await client.query(`SELECT * FROM public."${name}" ORDER BY "${key}"`)).rows;
      // Compare original columns: the sole new field is separately checked as NULL.
      for (const row of rows) if (name === 'Endpoint') delete row.ownerId;
      snapshot[name] = { count: rows.length, sha256: hash(JSON.stringify(rows)), rows: rows.map(row => ({ id: row[key], sha256: hash(JSON.stringify(row)) })) };
    }
    const claimed = applied ? (await client.query('SELECT count(*)::int AS count FROM "Endpoint" WHERE "ownerId" IS NOT NULL')).rows[0].count : 0;
    await client.query('ROLLBACK');
    return { identity, applied, history: history.map(row => row.migration_name), snapshot, claimed };
  } finally { await client.end(); }
}

try {
  const target = process.argv[2];
  if (!['test', 'development'].includes(target ?? '') || process.env.AUTHENTICATION_MIGRATION_APPROVED !== 'true' || process.env.NODE_ENV === 'production') throw new MigrationSafetyError('Explicit approval and target required.');
  if (target === 'test' && process.env.TEST_DATABASE_DISPOSABLE !== 'true') throw new MigrationSafetyError('Test database confirmation required.');
  const connectionString = target === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!connectionString) throw new MigrationSafetyError('Database configuration required.');
  const expectedName = target === 'test' ? 'watchtower_test' : 'watchtower_dev';
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || (url.port || '5432') !== '5432' || url.pathname !== `/${expectedName}` || [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) throw new MigrationSafetyError('Configured target mismatch.');
  const files = readdirSync('prisma/migrations', { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (JSON.stringify(files) !== JSON.stringify(known)) throw new MigrationSafetyError('Unexpected local migration files.');
  if (hash(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8').replace(/\r\n/g, '\n')) !== approvedChecksum) throw new MigrationSafetyError('Reviewed SQL changed.');
  const before = await inspect(connectionString, expectedName);
  if (before.applied) throw new MigrationSafetyError('Migration already applied; this helper will not reapply it.');
  if (target === 'development' && (before.snapshot.Endpoint?.count !== 9 || before.snapshot.CheckResult?.count !== 22)) throw new MigrationSafetyError('Development counts differ from approved baseline.');
  mkdirSync('../web/artifacts', { recursive: true });
  writeFileSync(`../web/artifacts/phase6a-${target}-before.json`, JSON.stringify(before, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ target: before.identity, reviewedChecksum: approvedChecksum, before: Object.fromEntries(Object.entries(before.snapshot).map(([name, table]) => [name, { count: table.count, sha256: table.sha256 }])) }));
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: connectionString } });
  if (result.status !== 0) throw new MigrationSafetyError('Migration failed; no repair or reset attempted.');
  const after = await inspect(connectionString, expectedName);
  if (!after.applied || after.claimed !== 0 || JSON.stringify(after.snapshot) !== JSON.stringify(before.snapshot)) throw new MigrationSafetyError('Post-migration integrity mismatch.');
  console.log(JSON.stringify({ migration, target: after.identity, applied: true, originalRecordsUnchanged: true, claimedEndpoints: after.claimed }));
} catch (error) {
  console.error(error instanceof MigrationSafetyError
    ? error.message : 'Guarded authentication migration failed. Credentials and records are not logged. Inspect safely before continuing.');
  process.exitCode = 1;
}
