import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { notificationSchemaReady } from './helpers/notification-schema-ready.js';
import { notificationCleanup } from './helpers/notification-cleanup.js';
import { assertDisposableDatabase } from '../src/database/disposable-database.js';
import { createDatabaseClient } from '../src/database/database-client.js';
import { createAuthRepository } from '../src/auth/auth-repository.js';
import { createAuthService } from '../src/auth/auth-service.js';
import { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import { createMonitoringService } from '../src/monitoring/monitoring-service.js';
import { createOutboxRepository } from '../src/notifications/outbox-repository.js';
import { inferJsonSchema } from '../src/schema-comparison/compare-json-schema.js';
import { createApp } from '../src/app.js';
import type { FetchResult } from '../src/monitoring/safe-json-fetcher.js';

const failure: FetchResult = { ok: false, outcome: 'network_error', errorCode: 'timeout', httpStatus: null, responseTimeMs: 8000 };
const healthy: FetchResult = { ok: true, value: { id: 1 }, httpStatus: 200, responseTimeMs: 5 };
describe.skipIf(!await notificationSchemaReady())('PostgreSQL incidents/outbox (requires approved Phase 6B migration)', () => {
  let client: ReturnType<typeof createDatabaseClient>, reader: ReturnType<typeof createDatabaseClient>;
  const endpoints: string[] = [], users: string[] = [];
  beforeAll(async () => {
    const url = assertDisposableDatabase(process.env.TEST_DATABASE_URL, 'test', process.env.TEST_DATABASE_DISPOSABLE);
    client = createDatabaseClient(url); reader = createDatabaseClient(url);
    expect((await client.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0]?.name).toBe('watchtower_test');
  });
  afterEach(async () => {
    await client.$transaction([...notificationCleanup(client, [...endpoints]),
      client.checkResult.deleteMany({ where: { endpointId: { in: [...endpoints] } } }),
      client.endpoint.deleteMany({ where: { id: { in: [...endpoints] } } }), client.user.deleteMany({ where: { id: { in: [...users] } } })]);
    endpoints.length = 0; users.length = 0;
  });
  afterAll(async () => { if (client) await client.$disconnect(); if (reader) await reader.$disconnect(); });
  async function fixture() {
    const auth = createAuthService(createAuthRepository(client));
    const credentials = { email: `${randomUUID()}@example.test`, password: randomBytes(24).toString('base64url') };
    await auth.register(credentials); const owner = await auth.login(credentials); users.push(owner.user.id);
    const repository = createMonitoringRepository(client); let response = failure;
    const service = createMonitoringService(repository, async () => response);
    const endpoint = await service.register({ name: 'Notification integration fixture', url: 'https://jsonplaceholder.typicode.com/todos/1' }, owner.user.id); endpoints.push(endpoint.id);
    const box = createOutboxRepository(client), otherBox = createOutboxRepository(reader);
    async function configure(enabled: boolean) {
      const current = await service.notificationSettings(endpoint.id, owner.user.id);
      return service.configureNotifications(endpoint.id, enabled, current.updatedAt?.toISOString() ?? null, owner.user.id);
    }
    return { auth, credentials, owner, repository, service, endpoint, box, otherBox, configure, setResponse: (value: FetchResult) => { response = value; },
      check: () => service.check(endpoint.id, owner.user.id), history: () => repository.notifications.history(endpoint.id, owner.user.id, 100) };
  }
  it('tracks disabled incidents without queuing historical or repeated failures after opt-in', async () => {
    const f = await fixture(); expect((await f.service.notificationSettings(f.endpoint.id, f.owner.user.id)).enabled).toBe(false);
    await f.check(); await f.configure(true); await f.check();
    const events = await f.history(); expect(events).toHaveLength(1); expect(events[0]?.outbox).toBeNull();
    expect(await f.box.claim()).toBeNull();
  });
  it('deduplicates persistent failures, closes recovery, and creates a new failure episode', async () => {
    const f = await fixture(); await f.configure(true); await f.check(); await f.check();
    expect(await f.history()).toHaveLength(1);
    f.setResponse(healthy); await f.check(); f.setResponse(failure); await f.check();
    const events = await f.history(); expect(events.filter(row => row.kind === 'failure')).toHaveLength(2); expect(events.filter(row => row.kind === 'recovery')).toHaveLength(1);
    expect(events.every(row => row.outbox?.state === 'pending')).toBe(true);
    expect(await client.incident.count({ where: { endpointId: f.endpoint.id, closedAt: null } })).toBe(1);
  });
  it('requires an accepted baseline for schema events and suppresses repeated deviations', async () => {
    const f = await fixture(); await f.configure(true); f.setResponse({ ...healthy, ok: true, value: { id: '1' } });
    await f.check(); expect(await f.history()).toHaveLength(0);
    await f.repository.setBaseline(f.endpoint.id, inferJsonSchema({ id: 1 }));
    await f.check(); await f.check(); expect(await f.history()).toHaveLength(1);
    f.setResponse(healthy); await f.check(); expect((await f.history()).some(row => row.kind === 'schema_restored')).toBe(true);
  });
  it('records changed deviations but resolves explicit baseline acceptance without fake recovery', async () => {
    const f = await fixture(); await f.configure(true); await f.repository.setBaseline(f.endpoint.id, inferJsonSchema({ id: 1 }));
    f.setResponse({ ...healthy, ok: true, value: { id: '1' } }); await f.check();
    f.setResponse({ ...healthy, ok: true, value: { id: null } }); await f.check();
    const current = await f.repository.getEndpoint(f.endpoint.id);
    await f.service.acceptBaseline(f.endpoint.id, current!.updatedAt.toISOString(), f.owner.user.id);
    const history = await f.history(); expect(history.filter(row => row.kind === 'schema_changed')).toHaveLength(2);
    expect(history.some(row => row.kind === 'schema_restored')).toBe(false);
    expect(history[0]?.incident.resolution).toBe('baseline_accepted');
  });
  it('rolls back the check, incident, event and outbox together', async () => {
    const f = await fixture(); await f.configure(true);
    await expect(f.repository.runExclusive(f.endpoint.id, async store => {
      const check = await store.recordCheck({ endpointId: f.endpoint.id, outcome: 'network_error', errorCode: 'timeout', httpStatus: null, responseTimeMs: 8 });
      await store.notifications.observe(f.endpoint, check); throw new Error('rollback fixture');
    })).rejects.toThrow('rollback fixture');
    expect(await f.history()).toHaveLength(0); expect(await client.checkResult.count({ where: { endpointId: f.endpoint.id } })).toBe(0);
    expect(await client.incident.count({ where: { endpointId: f.endpoint.id } })).toBe(0);
  });
  it('persists scheduled failure and outbox state through an independent client', async () => {
    const f = await fixture(); await f.configure(true); await f.service.configureSchedule(f.endpoint.id, true, 5, f.owner.user.id);
    await f.service.checkScheduled(f.endpoint.id);
    expect((await createMonitoringRepository(reader).notifications.history(f.endpoint.id, f.owner.user.id, 10))[0]?.outbox?.state).toBe('pending');
    expect(await f.repository.scheduledHistory(f.endpoint.id)).toHaveLength(1);
  });
  it('bounds claims across dispatchers and releases capacity after acknowledgement', async () => {
    const f = await fixture(); await f.configure(true); await f.check(); f.setResponse(healthy); await f.check(); f.setResponse(failure); await f.check();
    const first = await f.box.claim(), second = await f.otherBox.claim(); expect(first).not.toBeNull(); expect(second).not.toBeNull(); expect(first!.eventId).not.toBe(second!.eventId);
    expect(await f.box.claim()).toBeNull(); await f.box.complete(first!, { kind: 'accepted' });
    expect(await f.otherBox.claim()).not.toBeNull();
  });
  it('recovers expired leases and fences a stale acknowledgement', async () => {
    const f = await fixture(); await f.configure(true); await f.check(); const first = (await f.box.claim())!;
    await client.emailOutbox.update({ where: { eventId: first.eventId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const recovered = (await f.otherBox.claim())!; expect(recovered.attempts).toBe(2); expect(recovered.leaseToken).not.toBe(first.leaseToken);
    expect(await f.box.complete(first, { kind: 'accepted' })).toBe(false);
    expect(await f.otherBox.complete(recovered, { kind: 'accepted' })).toBe(true);
    expect((await client.emailAttempt.findUniqueOrThrow({ where: { eventId_number: { eventId: first.eventId, number: 1 } } })).state).toBe('interrupted');
  });
  it('persists backoff and stops retrying after five bounded attempts', async () => {
    const f = await fixture(); await f.configure(true); await f.check();
    for (let number = 1; number <= 5; number++) {
      const job = (await f.box.claim())!; expect(job.attempts).toBe(number);
      await f.box.complete(job, { kind: 'failed', code: 'smtp_timeout', retryable: true });
      const saved = await client.emailOutbox.findUniqueOrThrow({ where: { eventId: job.eventId } });
      if (number < 5) { expect(saved.state).toBe('pending'); expect(saved.availableAt.getTime()).toBeGreaterThan(Date.now());
        await client.emailOutbox.update({ where: { eventId: job.eventId }, data: { availableAt: new Date(Date.now() - 1000) } }); }
      else expect(saved.state).toBe('failed');
    }
    expect(await f.box.claim()).toBeNull(); expect((await f.history())[0]?.outbox?.deliveries).toHaveLength(5);
  });
  it('cancels queued mail when disabled but truthfully records an already accepted send', async () => {
    const f = await fixture(); await f.configure(true); await f.check(); const job = (await f.box.claim())!;
    await f.configure(false); expect(await f.box.allowed(job.eventId, job.leaseToken!)).toBe(false);
    await f.box.complete(job, { kind: 'accepted' }); expect((await f.history())[0]?.outbox?.state).toBe('smtp_accepted');
    f.setResponse(healthy); await f.configure(true); await f.check(); await f.configure(false);
    expect((await f.history()).some(event => event.outbox?.state === 'cancelled')).toBe(true);
    expect(await f.box.claim()).toBeNull();
  });
  it('rejects stale preference versions and uses monotonic stored versions', async () => {
    const f = await fixture(); const first = await f.configure(true); const second = await f.configure(false);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    await expect(f.service.configureNotifications(f.endpoint.id, true, first.updatedAt.toISOString(), f.owner.user.id)).rejects.toMatchObject({ status: 409 });
  });
  it('isolates preferences and event history by authenticated owner and hides lease tokens', async () => {
    const f = await fixture(); await f.configure(true); await f.check();
    const credentials = { ...f.credentials, email: `${randomUUID()}@example.test` }; await f.auth.register(credentials); const other = await f.auth.login(credentials); users.push(other.user.id);
    const app = createApp({ monitoring: f.service, authentication: f.auth, environment: { NODE_ENV: 'development', ENABLE_LOCAL_MANAGEMENT: 'true' } });
    const headers = { 'X-Watchtower-Local': '1', Cookie: `watchtower_session=${other.token}`, 'X-CSRF-Token': other.csrfToken };
    const path = `/api/endpoints/${f.endpoint.id}`;
    expect((await request(app).get(path + '/notifications').set(headers)).status).toBe(404);
    expect((await request(app).get(path + '/notification-settings').set(headers)).status).toBe(404);
    expect((await request(app).put(path + '/notification-settings').set(headers).send({ enabled: false, expectedUpdatedAt: null })).status).toBe(404);
    const job = (await f.box.claim())!; await f.box.complete(job, { kind: 'accepted' });
    expect(JSON.stringify(await f.history())).not.toContain('leaseToken');
  });
});
