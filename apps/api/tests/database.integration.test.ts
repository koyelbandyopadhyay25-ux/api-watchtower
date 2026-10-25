import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../src/database/database-client.js';
import { assertDisposableDatabase } from '../src/database/disposable-database.js';
import { DatabaseError } from '../src/database/database-errors.js';
import { createMonitoringRepository } from '../src/database/monitoring-repository.js';

// No fallback to DATABASE_URL. Missing infrastructure is explicitly skipped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL persistence (isolated test database)', () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let repository: ReturnType<typeof createMonitoringRepository>;
  const ownedEndpoints: string[] = [];
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
    ]);
    ownedEndpoints.length = 0;
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
});
