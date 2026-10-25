import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

type Snapshot = { snapshot: Record<string, { rows: { id: string; sha256: string }[] }> };
const known = ['20261025094835_init', '20261025121417_add_endpoint_scheduling', '20261025150000_add_authentication_ownership'];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function verify(target: 'test' | 'development') {
  const connectionString = target === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!connectionString) throw new Error();
  const name = target === 'test' ? 'watchtower_test' : 'watchtower_dev';
  const url = new URL(connectionString);
  if (url.hostname !== '127.0.0.1' || (url.port || '5432') !== '5432' || url.pathname !== `/${name}`) throw new Error();
  const before = JSON.parse(readFileSync(`../web/artifacts/phase6a-${target}-before.json`, 'utf8')) as Snapshot;
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect(); await client.query('BEGIN READ ONLY');
    const identity = (await client.query('SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
    if (identity.name !== name || identity.host !== '127.0.0.1' || identity.port !== 5432) throw new Error();
    const applied = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name')).rows;
    if (JSON.stringify(applied.map(row => row.migration_name)) !== JSON.stringify(known) || applied.some(row => !row.finished_at || row.rolled_back_at)) throw new Error();
    for (const row of applied) {
      const sql = readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`, 'utf8').replace(/\r\n/g, '\n');
      if (![sql, sql.replace(/\n/g, '\r\n')].some(text => hash(text) === row.checksum)) throw new Error();
    }
    const counts: Record<string, number> = {};
    let verified = 0;
    for (const [table, key] of [['Endpoint', 'id'], ['CheckResult', 'id'], ['SchemaChange', 'id'], ['EndpointSchedule', 'endpointId'], ['ScheduledCheck', 'checkResultId']] as const) {
      const current = (await client.query(`SELECT * FROM public."${table}"`)).rows;
      counts[table] = current.length;
      const rows = new Map(current.map(row => [row[key], row]));
      for (const saved of before.snapshot[table]!.rows) {
        const row = rows.get(saved.id);
        if (!row) throw new Error();
        if (table === 'Endpoint') { if (row.ownerId !== null) throw new Error(); delete row.ownerId; }
        if (hash(JSON.stringify(row)) !== saved.sha256) throw new Error();
        verified++;
      }
    }
    const state = (await client.query(`SELECT (SELECT count(*)::int FROM "EndpointSchedule" WHERE enabled) AS "enabledSchedules",
      (SELECT count(*)::int FROM "User") AS users, (SELECT count(*)::int FROM "Session") AS sessions,
      (SELECT count(*)::int FROM "Endpoint" WHERE "ownerId" IS NULL) AS "unclaimedEndpoints"`)).rows[0];
    await client.query('ROLLBACK');
    return { target: identity, migrationsVerified: 3, originalRowsVerified: verified, originalRecordsUnchanged: true, counts, ...state };
  } finally { await client.end(); }
}
try { console.log(JSON.stringify({ readOnly: true, databases: [await verify('test'), await verify('development')] }, null, 2)); }
catch { console.error('Read-only preservation verification failed. Stop and inspect targets, migrations, and original hashes; no credentials or records logged.'); process.exitCode = 1; }
