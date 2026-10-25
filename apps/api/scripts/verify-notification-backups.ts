/** One-time approved backup checkpoint. Never restores into the application cluster. */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const tables = { Endpoint: 'id', CheckResult: 'id', SchemaChange: 'id', EndpointSchedule: 'endpointId', ScheduledCheck: 'checkResultId', User: 'id', Session: 'tokenHash', _prisma_migrations: 'id' };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bin = 'D:/PostgreSQL/bin';
const directory = resolve(process.env.WATCHTOWER_BACKUP_DIRECTORY ?? '');
if (!process.env.WATCHTOWER_BACKUP_DIRECTORY || directory.startsWith(resolve('../..'))) throw new Error('An explicit backup directory outside the repository is required.');
mkdirSync(directory, { recursive: true });
const cluster = join(directory, 'restore-verification-cluster');
const passwordFile = join(directory, 'temporary-init-password');
const password = randomBytes(32).toString('hex');
const restoreEnv = { ...process.env, PGHOST: '127.0.0.1', PGPORT: '55432', PGUSER: 'backup_verifier', PGPASSWORD: password };
function run(name: string, args: string[], env = process.env) {
  // A detached Windows postgres child must not inherit a captured pipe.
  const result = spawnSync(join(bin, `${name}.exe`), args, { env, encoding: 'utf8', windowsHide: true, timeout: 120_000, ...(name === 'pg_ctl' ? { stdio: 'ignore' as const } : {}) });
  if (result.status !== 0) throw new Error(`${name} failed; no credentials logged. Exit ${result.status}.`);
  return result.stdout;
}
async function snapshot(config: pg.ClientConfig) {
  const client = new pg.Client({ ...config, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query('SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
    const result: Record<string, unknown> = {};
    for (const [table, key] of Object.entries(tables)) {
      const rows = (await client.query(`SELECT * FROM public."${table}" ORDER BY "${key}"`)).rows;
      result[table] = { count: rows.length, sha256: hash(rows), rows: rows.map(row => ({ keyHash: hash(row[key]), sha256: hash(row) })) };
    }
    await client.query('ROLLBACK');
    return { identity, tables: result };
  } finally { await client.end(); }
}
const manifest: { verified: boolean; databases: unknown[] } = { verified: false, databases: [] };
let started = false;
try {
  // Refuse an occupied verification port before creating or starting anything there.
  const net = await import('node:net');
  await new Promise<void>((resolvePort, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(55432, '127.0.0.1', () => server.close(error => error ? reject(error) : resolvePort()));
  });
  writeFileSync(passwordFile, password, { flag: 'wx', mode: 0o600 });
  run('initdb', ['-D', cluster, '-U', 'backup_verifier', `--pwfile=${passwordFile}`, '--auth=scram-sha-256', '--encoding=UTF8', '--no-locale']);
  unlinkSync(passwordFile);
  run('pg_ctl', ['-D', cluster, '-o', '-h 127.0.0.1 -p 55432 -c timezone=UTC', '-l', join(directory, 'restore-verification.log'), '-w', 'start']);
  started = true;
  for (const target of ['test', 'dev']) {
    const connectionString = target === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Missing source configuration.');
    const url = new URL(connectionString);
    if (url.hostname !== '127.0.0.1' || (url.port || '5432') !== '5432' || url.pathname !== `/watchtower_${target}`) throw new Error('Source database mismatch.');
    const before = await snapshot({ connectionString });
    if (before.identity.name !== `watchtower_${target}` || before.identity.host !== '127.0.0.1' || before.identity.port !== 5432) throw new Error('Source identity mismatch.');
    const archive = join(directory, `watchtower_${target}.dump`);
    const sourceEnv = { ...process.env, PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: `watchtower_${target}` };
    run('pg_dump', ['--format=custom', '--no-password', '--file', archive], sourceEnv);
    const toc = run('pg_restore', ['--list', archive]);
    writeFileSync(join(directory, `watchtower_${target}.toc`), toc);
    const restoredName = `verify_watchtower_${target}`;
    run('createdb', ['--no-password', restoredName], restoreEnv);
    run('pg_restore', ['--no-password', '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', '--dbname', restoredName, archive], restoreEnv);
    const restored = await snapshot({ host: '127.0.0.1', port: 55432, user: 'backup_verifier', password, database: restoredName });
    const after = await snapshot({ connectionString });
    if (JSON.stringify(before.tables) !== JSON.stringify(restored.tables) || JSON.stringify(before.tables) !== JSON.stringify(after.tables)) throw new Error('Backup restoration/source integrity mismatch.');
    manifest.databases.push({ source: before, archive, archiveSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), restoredIdentity: restored.identity, restorationVerified: true });
    console.log(JSON.stringify({ database: before.identity, archive, restorationVerified: true }));
  }
  manifest.verified = true;
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
} finally {
  if (started) run('pg_ctl', ['-D', cluster, '-w', '-m', 'fast', 'stop']);
}
