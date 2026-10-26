import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../src/database/database-client.js';
import { assertDisposableDatabase } from '../src/database/disposable-database.js';
import { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import { createAuthRepository } from '../src/auth/auth-repository.js';
import { createAuthService } from '../src/auth/auth-service.js';
import { createMonitoringService } from '../src/monitoring/monitoring-service.js';
import type { InferredSchema } from '../src/schema-comparison/schema-types.js';
import { SUPPORTED_ENDPOINTS } from '../src/monitoring/supported-endpoints.js';
import { authSchemaReady } from './helpers/auth-schema-ready.js';
import { notificationCleanup } from './helpers/notification-cleanup.js';

const runLiveChecks = process.env.WATCHTOWER_LIVE_TARGET_TEST === 'true';
const databaseReady = await authSchemaReady();

describe.skipIf(!runLiveChecks || !databaseReady)('approved public endpoint live persistence', () => {
  let client: ReturnType<typeof createDatabaseClient>;
  const endpoints: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(assertDisposableDatabase(
      process.env.TEST_DATABASE_URL, 'test', process.env.TEST_DATABASE_DISPOSABLE,
    ));
    const identity = await client.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    expect(identity[0]?.name).toBe('watchtower_test');
    await client.endpoint.count(); // Confirm the existing schema; never create or reset tables.
  });

  afterEach(async () => {
    if (!client) return;
    const ids = [...endpoints];
    await client.$transaction([
      ...notificationCleanup(client, ids),
      client.scheduledCheck.deleteMany({ where: { endpointId: { in: ids } } }),
      client.checkResult.deleteMany({ where: { endpointId: { in: ids } } }),
      client.endpointSchedule.deleteMany({ where: { endpointId: { in: ids } } }),
      client.endpoint.deleteMany({ where: { id: { in: ids } } }),
      client.user.deleteMany({ where: { id: { in: [...users] } } }),
    ]);
    endpoints.length = 0;
    users.length = 0;
  });

  afterAll(async () => { if (client) await client.$disconnect(); });

  it.each(SUPPORTED_ENDPOINTS.slice(2))('checks, accepts a real baseline, compares, and persists $label', async target => {
    const email = `${randomUUID()}@example.test`;
    const credentials = { email, password: randomBytes(24).toString('base64url') };
    const auth = createAuthService(createAuthRepository(client));
    await auth.register(credentials);
    const user = await createAuthRepository(client).findUser(email);
    expect(user).not.toBeNull();
    users.push(user!.id);

    const repository = createMonitoringRepository(client);
    const service = createMonitoringService(repository); // Uses the real guarded HTTPS fetcher.
    const endpoint = await service.register({ name: `Live target ${target.label}`, url: target.url }, user!.id);
    endpoints.push(endpoint.id);
    expect((await service.schedule(endpoint.id, user!.id)).enabled).toBe(false);
    expect((await service.notificationSettings(endpoint.id, user!.id)).enabled).toBe(false);

    const captured = await service.acceptBaseline(endpoint.id, endpoint.updatedAt.toISOString(), user!.id);
    expect(captured.check).toMatchObject({ httpStatus: 200, errorCode: null });
    expect(captured.comparison).toBe('baseline_missing');
    const saved = await repository.getEndpoint(endpoint.id);
    expect(saved?.url).toBe(target.url);
    const baseline = saved?.baselineSchema as unknown as InferredSchema;
    expect(baseline).toBeTruthy();

    if (target.path === '/users/1') {
      expect(baseline.types).toEqual(['object']);
      expect(baseline.properties?.address?.types).toEqual(['object']);
      expect(baseline.properties?.address?.properties?.geo?.types).toEqual(['object']);
      expect(baseline.properties?.company?.types).toEqual(['object']);
    } else {
      expect(baseline.types).toEqual(['array']);
      expect(baseline.items?.types).toEqual(['object']);
      for (const property of ['postId', 'id', 'name', 'email', 'body']) {
        expect(baseline.items?.properties?.[property]?.types)
          .toEqual(property === 'id' || property === 'postId' ? ['number'] : ['string']);
      }
    }

    const compared = await service.check(endpoint.id, user!.id);
    expect(compared.comparison).toBe('compared');
    expect(compared.check.httpStatus).toBe(200);
    expect(['success', 'schema_changed']).toContain(compared.check.outcome);

    const history = await repository.listCheckResults(endpoint.id, 10);
    expect(history).toHaveLength(2);
    expect(history.every(check => check.httpStatus === 200)).toBe(true);
    expect(history.some(check => check.id === compared.check.id)).toBe(true);

    await service.configureSchedule(endpoint.id, true, 5, user!.id);
    const scheduled = await service.checkScheduled(endpoint.id);
    expect(scheduled?.check.httpStatus).toBe(200);
    expect(await repository.scheduledHistory(endpoint.id, 10)).toHaveLength(1);
    await service.configureSchedule(endpoint.id, false, 5, user!.id);
    expect((await service.schedule(endpoint.id, user!.id)).enabled).toBe(false);
    const events = await service.notificationHistory(endpoint.id, 10, user!.id);
    expect(events.every(event => event.outbox === null)).toBe(true);

    const reader = createDatabaseClient(process.env.TEST_DATABASE_URL!);
    try {
      const persisted = createMonitoringRepository(reader);
      expect((await persisted.getEndpoint(endpoint.id))?.baselineSchema).toEqual(saved?.baselineSchema);
      expect(await persisted.getCheckResult(captured.check.id)).toMatchObject({ endpointId: endpoint.id, httpStatus: 200 });
      expect(await persisted.getCheckResult(compared.check.id)).toMatchObject({ endpointId: endpoint.id, httpStatus: 200 });
      expect((await persisted.listCheckResults(endpoint.id, 10)).filter(check => check.scheduledCheck !== null)).toHaveLength(1);
    } finally {
      await reader.$disconnect();
    }
  });
});
