import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

const known = ['20261025094835_init', '20261025121417_add_endpoint_scheduling', '20261025150000_add_authentication_ownership'];
const proposed = '20261025160000_add_notification_outbox';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
async function inspect(target: 'dev' | 'test') {
  const connectionString = target === 'dev' ? process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
  if (!connectionString || process.env.NODE_ENV === 'production') throw new Error();
  const url = new URL(connectionString);
  if (url.hostname !== '127.0.0.1' || (url.port || '5432') !== '5432' || url.pathname !== `/watchtower_${target}` || [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) throw new Error();
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect(); await client.query('BEGIN READ ONLY');
    const identity = (await client.query('SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
    if (identity.name !== `watchtower_${target}` || identity.host !== '127.0.0.1' || identity.port !== 5432) throw new Error();
    const history = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name')).rows;
    if (JSON.stringify(history.map(row => row.migration_name)) !== JSON.stringify(known) || history.some(row => !row.finished_at || row.rolled_back_at)) throw new Error();
    for (const row of history) {
      const sql = readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`, 'utf8').replace(/\r\n/g, '\n');
      if (![sql, sql.replace(/\n/g, '\r\n')].some(text => digest(text) === row.checksum)) throw new Error();
    }
    const additions = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('NotificationPreference','Incident','NotificationEvent','EmailOutbox','EmailAttempt')")).rows;
    if (additions.length) throw new Error();
    const tables: Record<string, { count: number; sha256: string }> = {};
    for (const [name, key] of [['Endpoint','id'], ['CheckResult','id'], ['SchemaChange','id'], ['EndpointSchedule','endpointId'], ['ScheduledCheck','checkResultId'], ['User','id'], ['Session','tokenHash']]) {
      const rows = (await client.query(`SELECT * FROM public."${name}" ORDER BY "${key}"`)).rows;
      tables[name!] = { count: rows.length, sha256: digest(JSON.stringify(rows)) };
    }
    await client.query('ROLLBACK'); return { ...identity, migrations: history.map(row => ({ name: row.migration_name, checksum: row.checksum })), notificationSchema: 'absent', tables };
  } finally { await client.end(); }
}
try {
  const path = `prisma/migrations/${proposed}/migration.sql`;
  console.log(JSON.stringify({ readOnly: true, proposed, sqlSha256: existsSync(path) ? digest(readFileSync(path, 'utf8')) : null, databases: [await inspect('test'), await inspect('dev')] }, null, 2));
} catch { console.error('Read-only notification plan rejected. Verify exact local targets, known migration checksums and absence of partial notification schema. No credentials or records logged.'); process.exitCode = 1; }
