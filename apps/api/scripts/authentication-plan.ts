import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Deliberately has NO apply mode. All statements run in a read-only transaction.
const known = ['20261025094835_init', '20261025121417_add_endpoint_scheduling'];
const migration = '20261025150000_add_authentication_ownership';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let stage = 'configuration';
async function inspect(target: 'dev' | 'test') {
  const connectionString = target === 'dev' ? process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
  if (!connectionString || process.env.NODE_ENV === 'production') throw new Error();
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || (url.port || '5432') !== '5432' || url.pathname !== `/watchtower_${target}` ||
    [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) throw new Error();
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    stage = `${target}: connection`;
    await client.connect(); await client.query('BEGIN READ ONLY');
    const identity = (await client.query('SELECT current_database() AS name, host(inet_server_addr()) AS address, inet_server_port() AS port')).rows[0];
    stage = `${target}: database identity`;
    if (identity.name !== `watchtower_${target}` || identity.address !== '127.0.0.1' || identity.port !== 5432) throw new Error();
    const applied = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name')).rows;
    stage = `${target}: migration history`;
    const complete = applied.some(row => row.migration_name === migration);
    if (JSON.stringify(applied.map(row => row.migration_name)) !== JSON.stringify(complete ? [...known, migration] : known) || applied.some(row => !row.finished_at || row.rolled_back_at)) throw new Error();
    for (const row of applied) {
      stage = `${target}: checksum ${row.migration_name}`;
      const sql = readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`, 'utf8').replace(/\r\n/g, '\n');
      if (![sql, sql.replace(/\n/g, '\r\n')].some(text => hash(text) === row.checksum)) throw new Error();
    }
    const additions = (await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='User' AND column_name='id') OR (table_name='Session' AND column_name='tokenHash') OR (table_name='Endpoint' AND column_name='ownerId'))")).rows;
    stage = `${target}: consistent authentication schema`;
    if (additions.length !== (complete ? 3 : 0)) throw new Error();
    const tables: Record<string, { count: number; sha256: string }> = {};
    for (const [name, key] of [['Endpoint', 'id'], ['CheckResult', 'id'], ['SchemaChange', 'id'], ['EndpointSchedule', 'endpointId'], ['ScheduledCheck', 'checkResultId']]) {
      const rows = (await client.query(`SELECT * FROM public."${name}" ORDER BY "${key}"`)).rows;
      tables[name!] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
    }
    await client.query('ROLLBACK');
    return { ...identity, applied: applied.map(row => ({ name: row.migration_name, checksum: row.checksum })), authenticationSchema: complete ? 'applied' : 'absent', tables };
  } finally { await client.end(); }
}
try {
  const databases = [await inspect('test'), await inspect('dev')];
  const sql = readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8');
  console.log(JSON.stringify({ readOnly: true, migration, sqlSha256: hash(sql), databases }, null, 2));
} catch {
  console.error(`Read-only authentication plan rejected at ${stage}. No credentials or records logged.`);
  process.exitCode = 1;
}
