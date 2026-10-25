import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authSchemaReady } from './helpers/auth-schema-ready.js';
import { assertDisposableDatabase } from '../src/database/disposable-database.js';
import { createDatabaseClient } from '../src/database/database-client.js';
import { createAuthRepository } from '../src/auth/auth-repository.js';
import { createAuthService, sessionHash } from '../src/auth/auth-service.js';
import { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import { createMonitoringService } from '../src/monitoring/monitoring-service.js';
import { createApp } from '../src/app.js';

describe.skipIf(!await authSchemaReady())('authentication PostgreSQL isolation (requires approved migration)', () => {
  let client: ReturnType<typeof createDatabaseClient>;
  const users: string[] = [], endpoints: string[] = [];
  beforeAll(async () => {
    client = createDatabaseClient(assertDisposableDatabase(process.env.TEST_DATABASE_URL, 'test', process.env.TEST_DATABASE_DISPOSABLE));
    expect((await client.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0]?.name).toBe('watchtower_test');
  });
  afterEach(async () => {
    await client.$transaction([
      client.checkResult.deleteMany({ where: { endpointId: { in: [...endpoints] } } }),
      client.endpoint.deleteMany({ where: { id: { in: [...endpoints] } } }),
      client.user.deleteMany({ where: { id: { in: [...users] } } }),
    ]);
    users.length = 0; endpoints.length = 0;
  });
  afterAll(async () => { if (client) await client.$disconnect(); });
  async function fixture() {
    const auth = createAuthService(createAuthRepository(client));
    const credentials = { email: `${randomUUID()}@example.test`, password: randomBytes(24).toString('base64url') };
    await auth.register(credentials); const owner = await auth.login(credentials); users.push(owner.user.id);
    const otherCredentials = { ...credentials, email: `${randomUUID()}@example.test` };
    await auth.register(otherCredentials); const other = await auth.login(otherCredentials); users.push(other.user.id);
    const repository = createMonitoringRepository(client);
    const service = createMonitoringService(repository, async () => ({ ok: true, value: { id: 1 }, httpStatus: 200, responseTimeMs: 5 }));
    const endpoint = await service.register({ name: 'Owned integration fixture', url: 'https://jsonplaceholder.typicode.com/todos/1' }, owner.user.id); endpoints.push(endpoint.id);
    const app = createApp({ monitoring: service, authentication: auth, environment: { NODE_ENV: 'development', ENABLE_LOCAL_MANAGEMENT: 'true' } });
    const headers = (session: typeof owner) => ({ 'X-Watchtower-Local': '1', Origin: 'http://localhost:5173', Cookie: `watchtower_session=${session.token}`, 'X-CSRF-Token': session.csrfToken });
    return { auth, credentials, owner, other, repository, service, endpoint, app, headers };
  }
  it('persists registration without changing duplicate passwords or claiming legacy rows', async () => {
    const f = await fixture(); const before = await client.user.findUniqueOrThrow({ where: { id: f.owner.user.id } });
    await f.auth.register({ ...f.credentials, password: randomBytes(24).toString('base64url') });
    expect((await client.user.findUniqueOrThrow({ where: { id: f.owner.user.id } })).passwordHash).toBe(before.passwordHash);
    expect(before.passwordHash.startsWith('$argon2id$')).toBe(true);
    const legacy = await f.repository.createEndpoint({ name: 'Unclaimed fixture', url: f.endpoint.url }); endpoints.push(legacy.id);
    expect((await f.service.list(100, f.owner.user.id)).map(row => row.id)).toEqual([f.endpoint.id]);
    await expect(f.service.get(legacy.id, f.owner.user.id)).rejects.toMatchObject({ status: 404 });
  });
  it('persists only session digests and revokes on logout', async () => {
    const f = await fixture(); const hash = sessionHash(f.owner.token);
    const saved = await client.session.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(saved.tokenHash).not.toBe(f.owner.token);
    expect((await f.auth.authenticate(f.owner.token)).user.id).toBe(f.owner.user.id);
    await f.auth.logout(f.owner.token);
    expect(await client.session.findUnique({ where: { tokenHash: hash } })).toBeNull();
    await expect(f.auth.authenticate(f.owner.token)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects expired persisted sessions', async () => {
    const f = await fixture();
    const future = createAuthService(createAuthRepository(client), () => new Date(f.owner.expiresAt.getTime()));
    await expect(future.authenticate(f.owner.token)).rejects.toMatchObject({ status: 401 });
  });
  it('enforces cross-user history, baseline, checks and scheduling through HTTP', async () => {
    const f = await fixture(); const route = `/api/endpoints/${f.endpoint.id}`;
    await f.service.check(f.endpoint.id, f.owner.user.id);
    for (const suffix of ['', '/checks', '/schedule', '/scheduled-checks']) expect((await request(f.app).get(route + suffix).set(f.headers(f.other))).status).toBe(404);
    expect((await request(f.app).post(route + '/checks').set(f.headers(f.other)).send({})).status).toBe(404);
    expect((await request(f.app).put(route + '/baseline').set(f.headers(f.other)).send({ accept: true, expectedUpdatedAt: f.endpoint.updatedAt.toISOString() })).status).toBe(404);
    expect((await request(f.app).put(route + '/schedule').set(f.headers(f.other)).send({ enabled: true, intervalMinutes: 5 })).status).toBe(404);
    expect((await f.repository.listCheckResults(f.endpoint.id))).toHaveLength(1);
    expect((await f.repository.getEndpoint(f.endpoint.id))?.baselineSchema).toBeNull();
    expect(await f.repository.getSchedule(f.endpoint.id)).toBeNull();
  });
  it('allows the independent internal scheduler after browser logout', async () => {
    const f = await fixture();
    await f.service.configureSchedule(f.endpoint.id, true, 5, f.owner.user.id);
    await f.auth.logout(f.owner.token);
    expect((await f.service.checkScheduled(f.endpoint.id))?.check.outcome).toBe('success');
    expect(await f.repository.scheduledHistory(f.endpoint.id)).toHaveLength(1);
    expect((await f.repository.getEndpoint(f.endpoint.id))?.baselineSchema).toBeNull();
  });
});
