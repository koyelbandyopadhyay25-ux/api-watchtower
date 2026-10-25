/** Read-only comparison of every pre-migration row, allowing new demo records. */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
if (!process.env.WATCHTOWER_BACKUP_DIRECTORY) throw new Error('Verified backup manifest required.');
const manifest = JSON.parse(readFileSync(join(process.env.WATCHTOWER_BACKUP_DIRECTORY, 'manifest.json'), 'utf8'));
const keys: Record<string, string> = { Endpoint: 'id', CheckResult: 'id', SchemaChange: 'id', EndpointSchedule: 'endpointId', ScheduledCheck: 'checkResultId', User: 'id', Session: 'tokenHash', _prisma_migrations: 'id' };
for (const target of ['test', 'dev']) {
  const connectionString = target === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing database configuration.');
  const url = new URL(connectionString);
  if (url.hostname !== '127.0.0.1' || (url.port || '5432') !== '5432' || url.pathname !== `/watchtower_${target}`) throw new Error('Unexpected target.');
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query('SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
    if (identity.name !== `watchtower_${target}` || identity.host !== '127.0.0.1' || identity.port !== 5432) throw new Error('Database identity mismatch.');
    const migrations = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name')).rows;
    const expected = ['20261025094835_init', '20261025121417_add_endpoint_scheduling', '20261025150000_add_authentication_ownership', '20261025160000_add_notification_outbox'];
    if (JSON.stringify(migrations.map(row => row.migration_name)) !== JSON.stringify(expected) || migrations.some(row => !row.finished_at || row.rolled_back_at)) throw new Error('Applied migration history mismatch.');
    for (const migration of migrations) {
      const sql = readFileSync(`prisma/migrations/${migration.migration_name}/migration.sql`, 'utf8').replace(/\r\n/g, '\n');
      if (![sql, sql.replace(/\n/g, '\r\n')].some(value => createHash('sha256').update(value).digest('hex') === migration.checksum)) throw new Error('Applied migration checksum mismatch.');
    }
    const backup = manifest.databases.find((item: { source: { identity: { name: string } } }) => item.source.identity.name === `watchtower_${target}`);
    const counts: Record<string, unknown> = {};
    for (const [table, key] of Object.entries(keys)) {
      const rows = (await client.query(`SELECT * FROM public."${table}" ORDER BY "${key}"`)).rows;
      const current = new Map(rows.map(row => [hash(row[key]), hash(row)]));
      const original = backup.source.tables[table];
      if (!original.rows.every((row: { keyHash: string; sha256: string }) => current.get(row.keyHash) === row.sha256)) throw new Error(`Original row integrity failed: ${target}/${table}.`);
      counts[table] = { original: original.count, current: rows.length, originalsUnchanged: true };
    }
    const newCounts: Record<string, number> = {};
    for (const table of ['NotificationPreference', 'Incident', 'NotificationEvent', 'EmailOutbox', 'EmailAttempt']) newCounts[table] = (await client.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows[0].count;
    const enabled = (await client.query('SELECT count(*)::int AS count FROM "NotificationPreference" WHERE enabled')).rows[0].count;
    const enabledSchedules = (await client.query('SELECT count(*)::int AS count FROM "EndpointSchedule" WHERE enabled')).rows[0].count;
    await client.query('ROLLBACK');
    const observations = (await client.query(`SELECT e.id, e.kind, e."endpointName", c.outcome, c."errorCode", c."httpStatus", o.state, o.attempts FROM "NotificationEvent" e JOIN "CheckResult" c ON c.id=e."checkResultId" LEFT JOIN "EmailOutbox" o ON o."eventId"=e.id ORDER BY e."createdAt"`)).rows;
    console.log(JSON.stringify({ identity, migrations: migrations.map(row => ({ name: row.migration_name, checksum: row.checksum })), counts, notificationCounts: newCounts, enabledPreferences: enabled, enabledSchedules, observations }, null, 2));
  } finally { await client.end(); }
}
console.log(JSON.stringify({ authCookieSecureOverride: process.env.AUTH_COOKIE_SECURE ?? 'unset (secure default)' }));
