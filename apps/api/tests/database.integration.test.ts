import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../src/database/database-client.js';
import { assertDisposableDatabase } from '../src/database/disposable-database.js';
import { DatabaseError } from '../src/database/database-errors.js';
import { createMonitoringRepository, createMonitoringStore } from '../src/database/monitoring-repository.js';
import supertest from 'supertest';
import { randomBytes } from 'node:crypto';
import { createAuthRepository } from '../src/auth/auth-repository.js';
import { createAuthService } from '../src/auth/auth-service.js';
import { createApp } from '../src/app.js';
import { createMonitoringService } from '../src/monitoring/monitoring-service.js';
import { inferJsonSchema } from '../src/schema-comparison/compare-json-schema.js';
import type { JsonValue } from '../src/schema-comparison/schema-types.js';
import { CheckCoordinationError } from '../src/database/check-coordination.js';
import { authSchemaReady } from './helpers/auth-schema-ready.js';

// No fallback to DATABASE_URL. Missing infrastructure is explicitly skipped.
describe.skipIf(!await authSchemaReady())('PostgreSQL persistence (requires approved authentication migration)', () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let repository: ReturnType<typeof createMonitoringRepository>;
  const ownedEndpoints: string[] = [];
  const ownedUsers: string[] = [];
  let initialized = false;

  beforeAll(async () => {
    const connectionString = assertDisposableDatabase(
      process.env.TEST_DATABASE_URL, 'test', process.env.TEST_DATABASE_DISPOSABLE,
    );
    client = createDatabaseClient(connectionString);
    repository = createMonitoringRepository(client);
    const identity = await client.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    expect(identity[0]?.name).toBe('watchtower_test');
    // Fail if migrations have not been applied; never create/drop tables in tests.
    await client.endpoint.count();
    initialized = true;
  });

  afterEach(async () => {
    if (!initialized) return;
    // Remove only rows created by this suite. Never truncate or reset a database.
    const ids = [...ownedEndpoints];
    await client.$transaction([
      client.checkResult.deleteMany({ where: { endpointId: { in: ids } } }),
      client.endpoint.deleteMany({ where: { id: { in: ids } } }),
      client.user.deleteMany({ where: { id: { in: [...ownedUsers] } } }),
    ]);
    ownedEndpoints.length = 0;
    ownedUsers.length = 0;
  });

  afterAll(async () => { if (client) await client.$disconnect(); });

  async function endpoint() {
    const record = await repository.createEndpoint({ name: 'Persistence test', url: 'https://example.com/api' });
    ownedEndpoints.push(record.id);
    return record;
  }

  it('persists and retrieves an endpoint through a separate database client', async () => {
    const saved = await endpoint();
    expect(saved.baselineSchema).toBeNull();
    expect(saved.createdAt).toBeInstanceOf(Date);
    const reader = createDatabaseClient(process.env.TEST_DATABASE_URL!);
    try {
      expect(await createMonitoringRepository(reader).getEndpoint(saved.id)).toEqual(saved);
    } finally {
      await reader.$disconnect();
    }
  });

  it('uses UTC sessions and returns actual database instants even in a non-UTC transaction', async () => {
    const timezone = await client.$queryRaw<{ zone: string }[]>`SELECT current_setting('TimeZone') AS zone`;
    expect(timezone[0]?.zone).toBe('UTC');
    await client.$transaction(async transaction => {
      await transaction.$executeRaw`SET LOCAL TIME ZONE 'Asia/Calcutta'`;
      const before = await transaction.$queryRaw<{ epochMs: bigint }[]>`
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "epochMs"
      `;
      const instant = await createMonitoringStore(transaction).databaseTime();
      const after = await transaction.$queryRaw<{ epochMs: bigint }[]>`
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "epochMs"
      `;
      expect(instant.getTime()).toBeGreaterThanOrEqual(Number(before[0]!.epochMs));
      expect(instant.getTime()).toBeLessThanOrEqual(Number(after[0]!.epochMs));
    });
  });

  it('preserves actual timestamp instants across Prisma and native PostgreSQL reads', async () => {
    const record = await endpoint();
    const actual = new Date();
    const check = await repository.recordCheck({ endpointId: record.id, checkedAt: actual,
      httpStatus: 200, responseTimeMs: 1, outcome: 'success' });
    const nativeEpoch = await client.$queryRaw<{ epochMs: bigint }[]>`
      SELECT (extract(epoch FROM "checkedAt") * 1000)::bigint AS "epochMs"
      FROM "CheckResult" WHERE "id" = ${check.id}::uuid
    `;
    expect(Number(nativeEpoch[0]!.epochMs)).toBe(actual.getTime());
    expect((await repository.getCheckResult(check.id))?.checkedAt).toEqual(actual);
  });

  it('records a check and schema changes without replacing the baseline', async () => {
    const saved = await endpoint();
    const baseline = { types: ['object' as const], properties: { id: { types: ['number' as const] } } };
    await repository.setBaseline(saved.id, baseline);
    const check = await repository.recordCheck({
      endpointId: saved.id, httpStatus: 200, responseTimeMs: 15, outcome: 'schema_changed',
      schemaChanges: [{ path: '$.id', changeType: 'type_changed', previousTypes: ['number'], currentTypes: ['string'] }],
    });
    const retrieved = await repository.getCheckResult(check.id);
    expect(retrieved).toMatchObject({ endpointId: saved.id, httpStatus: 200, responseTimeMs: 15, outcome: 'schema_changed' });
    expect(retrieved?.schemaChanges).toHaveLength(1);
    expect(retrieved?.schemaChanges[0]).toMatchObject({ path: '$.id', previousTypes: ['number'], currentTypes: ['string'] });
    expect(retrieved?.checkedAt).toBeInstanceOf(Date);
    expect((await repository.getEndpoint(saved.id))?.baselineSchema).toEqual(baseline);
    expect(await repository.listCheckResults(saved.id, 1)).toHaveLength(1);
    await repository.setBaseline(saved.id, null);
    expect((await repository.getEndpoint(saved.id))?.baselineSchema).toBeNull();
  });

  it('stores safe failure information and nullable HTTP metadata', async () => {
    const saved = await endpoint();
    const check = await repository.recordCheck({
      endpointId: saved.id, httpStatus: null, responseTimeMs: null,
      outcome: 'network_error', errorCode: 'timeout',
    });
    expect(await repository.getCheckResult(check.id)).toMatchObject({
      httpStatus: null, responseTimeMs: null, errorCode: 'timeout', schemaChanges: [],
    });
  });

  it('rejects an unknown endpoint without leaving an orphan check', async () => {
    const missing = randomUUID();
    await expect(repository.recordCheck({
      endpointId: missing, httpStatus: 200, responseTimeMs: 1, outcome: 'success',
    })).rejects.toBeInstanceOf(DatabaseError);
    expect(await client.checkResult.count({ where: { endpointId: missing } })).toBe(0);
  });

  it('restricts endpoint deletion and cascades changes when a check is deleted', async () => {
    const saved = await endpoint();
    const check = await repository.recordCheck({
      endpointId: saved.id, httpStatus: 200, responseTimeMs: 1, outcome: 'schema_changed',
      schemaChanges: [{ path: '$.new', changeType: 'added', previousTypes: [], currentTypes: ['boolean'] }],
    });
    await expect(client.endpoint.delete({ where: { id: saved.id } })).rejects.toBeDefined();
    await client.checkResult.delete({ where: { id: check.id } });
    expect(await client.schemaChange.count({ where: { checkResultId: check.id } })).toBe(0);
    expect(await repository.getEndpoint(saved.id)).not.toBeNull();
  });

  it('runs registration, explicit capture, comparison, and history through the REST API with real persistence', async () => {
    let requests = 0;
    const samples: JsonValue[] = [{ id: 1, email: 'private fixture value' }, { id: '1', active: true }];
    const service = createMonitoringService(repository, async () => ({
      ok: true, httpStatus: 200, responseTimeMs: 7,
      value: samples[++requests <= 2 ? 0 : 1]!,
    }));
    const authentication = createAuthService(createAuthRepository(client));
    const credentials = { email: `${randomUUID()}@example.test`, password: randomBytes(24).toString('base64url') };
    await authentication.register(credentials);
    const session = await authentication.login(credentials);
    ownedUsers.push(session.user.id);
    const api = createApp({ monitoring: service, authentication, environment: { NODE_ENV: 'development', ENABLE_LOCAL_MANAGEMENT: 'true' } });
    const request = (app: typeof api) => supertest.agent(app).set('Cookie', `watchtower_session=${session.token}`).set('X-CSRF-Token', session.csrfToken);
    const created = await request(api).post('/api/endpoints').set('X-Watchtower-Local', '1')
      .send({ name: 'Workflow integration test', url: 'https://jsonplaceholder.typicode.com/todos/1' });
    expect(created.status).toBe(201);
    const endpointId: string = created.body.id;
    ownedEndpoints.push(endpointId);
    expect(created.body.baselineSchema).toBeNull();
    const route = `/api/endpoints/${endpointId}`;
    const first = await request(api).post(`${route}/checks`).set('X-Watchtower-Local', '1').send({});
    expect(first.status).toBe(201);
    expect(first.body.comparison).toBe('baseline_missing');
    expect((await repository.getEndpoint(endpointId))?.baselineSchema).toBeNull();
    const acceptance = await request(api).put(`${route}/baseline`).set('X-Watchtower-Local', '1')
      .send({ accept: true, expectedUpdatedAt: created.body.updatedAt });
    expect(acceptance.status).toBe(200);
    const baseline = inferJsonSchema({ id: 1, email: 'private fixture value' });
    expect(acceptance.body.endpoint.baselineSchema).toEqual(baseline);
    const checked = await request(api).post(`${route}/checks`).set('X-Watchtower-Local', '1').send({});
    expect(checked.status).toBe(201);
    expect(checked.body.check.outcome).toBe('schema_changed');
    expect(checked.body.check.schemaChanges.map((change: { path: string; changeType: string }) => [change.path, change.changeType]))
      .toEqual([['$.active', 'added'], ['$.email', 'removed'], ['$.id', 'type_changed']]);
    const reader = createDatabaseClient(process.env.TEST_DATABASE_URL!);
    try {
      const persisted = createMonitoringRepository(reader);
      expect((await persisted.getEndpoint(endpointId))?.baselineSchema).toEqual(baseline);
      expect((await persisted.getCheckResult(checked.body.check.id))?.schemaChanges).toHaveLength(3);
    } finally { await reader.$disconnect(); }
    const history = await request(api).get(`${route}/checks`).set('X-Watchtower-Local', '1');
    expect(history.status).toBe(200);
    expect(history.body.checks).toHaveLength(3);
    expect(JSON.stringify(history.body)).not.toContain('private fixture value');
    const unsafe = await request(api).post('/api/endpoints').set('X-Watchtower-Local', '1')
      .send({ name: 'Blocked', url: 'https://127.0.0.1/' });
    expect(unsafe.status).toBe(400);
  });

  it('rejects stale baseline updates atomically without overwriting saved metadata', async () => {
    const saved = await endpoint();
    const baseline = inferJsonSchema({ preserved: true });
    await repository.setBaseline(saved.id, baseline);
    await expect(repository.acceptBaseline(saved.id, new Date(0), inferJsonSchema({ changed: 1 })))
      .rejects.toMatchObject({ code: 'conflict' });
    expect((await repository.getEndpoint(saved.id))?.baselineSchema).toEqual(baseline);
  });

  it('coordinates endpoint ownership across separate DB clients without needing new tables', async () => {
    const reader = createDatabaseClient(process.env.TEST_DATABASE_URL!);
    const other = createMonitoringRepository(reader);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const id = randomUUID();
    const pending = repository.runExclusive(id, async () => { entered(); await gate; return true; });
    try {
      await started;
      await expect(other.runExclusive(id, async () => true)).rejects.toBeInstanceOf(CheckCoordinationError);
    } finally { release(); await pending; }
    try { expect(await other.runExclusive(id, async () => true)).toBe(true); }
    finally { await reader.$disconnect(); }
  });

  it('reserves no more than three global transaction slots across DB clients', async () => {
    const reader = createDatabaseClient(process.env.TEST_DATABASE_URL!);
    const other = createMonitoringRepository(reader);
    let entered!: () => void, release!: () => void, count = 0;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = Array.from({ length: 3 }, () => repository.runExclusive(randomUUID(), async () => {
      if (++count === 3) entered();
      await gate;
      return true;
    }));
    try {
      await started;
      await expect(other.runExclusive(randomUUID(), async () => true)).rejects.toMatchObject({ reason: 'capacity' });
    } finally { release(); await Promise.all(pending); await reader.$disconnect(); }
  });
});
