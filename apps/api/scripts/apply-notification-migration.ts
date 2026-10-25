/** Explicitly approved, forward-only migration with verified-backup and integrity gates. */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const target = process.argv[2];
const migration = '20261025160000_add_notification_outbox';
const reviewedHash = 'cf2775743d771774b3e2748f43044acb62c78b6d32f40a98e86b8ecd624f29f1';
const previous = ['20261025094835_init', '20261025121417_add_endpoint_scheduling', '20261025150000_add_authentication_ownership'];
const tables = { Endpoint: 'id', CheckResult: 'id', SchemaChange: 'id', EndpointSchedule: 'endpointId', ScheduledCheck: 'checkResultId', User: 'id', Session: 'tokenHash' };
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
if (!['test', 'dev'].includes(target ?? '') || process.env.NOTIFICATION_MIGRATION_APPROVED !== 'true' || !process.env.WATCHTOWER_BACKUP_DIRECTORY) throw new Error('Explicit approval, exact target and verified backup manifest required.');
const manifest = JSON.parse(readFileSync(join(process.env.WATCHTOWER_BACKUP_DIRECTORY, 'manifest.json'), 'utf8'));
if (!manifest.verified || manifest.databases.length !== 2 || manifest.databases.some((item: { archive: string; archiveSha256: string; restorationVerified: boolean }) => !item.restorationVerified || digest(readFileSync(item.archive)) !== item.archiveSha256)) throw new Error('Both verified backup archives are required.');
const sql = readFileSync(`prisma/migrations/${migration}/migration.sql`);
if (digest(sql) !== reviewedHash) throw new Error('Reviewed SQL hash mismatch.');
const connectionString = target === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!connectionString || process.env.NODE_ENV === 'production' || (target === 'test' && process.env.TEST_DATABASE_DISPOSABLE !== 'true')) throw new Error('Unsafe environment.');
const url = new URL(connectionString);
if (url.hostname !== '127.0.0.1' || (url.port || '5432') !== '5432' || url.pathname !== `/watchtower_${target}` || [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) throw new Error('Unexpected target.');
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const identity = (await client.query('SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
  if (identity.name !== `watchtower_${target}` || identity.host !== '127.0.0.1' || identity.port !== 5432) throw new Error('Database identity mismatch.');
  const history = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name')).rows;
  if (JSON.stringify(history.map(row => row.migration_name)) !== JSON.stringify(previous) || history.some(row => !row.finished_at || row.rolled_back_at)) throw new Error('Migration history mismatch.');
  for (const row of history) {
    const content = readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`, 'utf8').replace(/\r\n/g, '\n');
    if (![content, content.replace(/\n/g, '\r\n')].some(text => digest(text) === row.checksum)) throw new Error('Existing migration checksum mismatch.');
  }
  const backup = manifest.databases.find((item: { source: { identity: { name: string } } }) => item.source.identity.name === identity.name);
  if (!backup) throw new Error('Missing database backup.');
  for (const [table, key] of Object.entries(tables)) {
    const rows = (await client.query(`SELECT * FROM public."${table}" ORDER BY "${key}"`)).rows;
    if (digest(JSON.stringify(rows)) !== backup.source.tables[table].sha256) throw new Error(`Pre-migration integrity mismatch: ${table}.`);
  }
  if (target === 'dev' && (backup.source.tables.Endpoint.count !== 17 || backup.source.tables.CheckResult.count !== 38)) throw new Error('Development baseline count mismatch.');
  const additions = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('NotificationPreference','Incident','NotificationEvent','EmailOutbox','EmailAttempt')")).rows;
  if (additions.length) throw new Error('Unexpected existing notification tables.');
  const result = spawnSync(process.execPath, [resolve('../../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: connectionString }, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  if (result.status !== 0) throw new Error('Prisma migration failed; stop and inspect its status safely.');
  const applied = (await client.query('SELECT checksum, finished_at, rolled_back_at FROM public._prisma_migrations WHERE migration_name=$1', [migration])).rows;
  if (applied.length !== 1 || applied[0].checksum !== reviewedHash || !applied[0].finished_at || applied[0].rolled_back_at) throw new Error('Migration verification failed.');
  const counts: Record<string, number> = {};
  for (const [table, key] of Object.entries(tables)) {
    const rows = (await client.query(`SELECT * FROM public."${table}" ORDER BY "${key}"`)).rows;
    if (digest(JSON.stringify(rows)) !== backup.source.tables[table].sha256) throw new Error(`Post-migration integrity mismatch: ${table}.`);
    counts[table] = rows.length;
  }
  for (const table of ['NotificationPreference', 'Incident', 'NotificationEvent', 'EmailOutbox', 'EmailAttempt']) {
    if ((await client.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows[0].count !== 0) throw new Error('Unexpected backfill or notification subscription.');
  }
  console.log(JSON.stringify({ identity, migration, checksum: reviewedHash, originalRecordsUnchanged: true, counts, newTablesEmpty: true }, null, 2));
} finally { await client.end(); }
