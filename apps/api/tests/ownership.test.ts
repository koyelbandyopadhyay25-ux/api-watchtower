import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMonitoringService } from '../src/monitoring/monitoring-service.js';
import type { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import { authFixture } from './helpers/auth-fixture.js';

const id = '11111111-1111-4111-8111-111111111111';
const headers = { 'X-Watchtower-Local': '1', Origin: 'http://localhost:5173' };
async function fixture() {
  const auth = authFixture();
  const credentials = { email: 'owner@example.test', password: 'Test-only password of sufficient length' };
  await auth.service.register(credentials); const owner = await auth.service.login(credentials);
  await auth.service.register({ ...credentials, email: 'other@example.test' });
  const other = await auth.service.login({ ...credentials, email: 'other@example.test' });
  const endpoint = { id, ownerId: owner.user.id as string | null, url: 'https://jsonplaceholder.typicode.com/todos/1', baselineSchema: null, updatedAt: new Date('2026-01-01') };
  const repository = {
    getEndpoint: vi.fn(async (requested: string) => requested === id ? endpoint : null),
    listEndpoints: vi.fn(async (_limit: number, ownerId: string) => endpoint.ownerId === ownerId ? [endpoint] : []),
    createEndpoint: vi.fn(async input => ({ ...endpoint, ...input })),
    listCheckResults: vi.fn(async () => []), scheduledHistory: vi.fn(async () => []), getSchedule: vi.fn(async () => null),
    recordCheck: vi.fn(async input => ({ id: 'actual', ...input })), saveSchedule: vi.fn(),
    runExclusive: vi.fn(async (_id: string, operation: (store: unknown, signal: AbortSignal) => Promise<unknown>) => operation(repository, new AbortController().signal)),
  };
  const fetch = vi.fn(async () => ({ ok: true as const, value: { id: 1 }, httpStatus: 200, responseTimeMs: 5 }));
  const service = createMonitoringService(repository as unknown as ReturnType<typeof createMonitoringRepository>, fetch);
  const app = createApp({ monitoring: service, authentication: auth.service, environment: { NODE_ENV: 'development', ENABLE_LOCAL_MANAGEMENT: 'true', AUTH_COOKIE_SECURE: 'false' } });
  function as(session: typeof owner) { return { ...headers, Cookie: `watchtower_session=${session.token}`, 'X-CSRF-Token': session.csrfToken }; }
  return { app, repository, service, fetch, endpoint, owner, other, as };
}

describe('ownership at the real authentication/service boundary', () => {
  it.each([
    ['GET', '', undefined], ['GET', '/checks', undefined], ['GET', '/schedule', undefined], ['GET', '/scheduled-checks', undefined],
    ['POST', '/checks', {}], ['PUT', '/baseline', { accept: true, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }],
    ['PUT', '/schedule', { enabled: true, intervalMinutes: 5 }],
  ] as const)('hides another user endpoint for %s %s', async (method, suffix, body) => {
    const f = await fixture();
    const agent = request(f.app); const path = `/api/endpoints/${id}${suffix}`;
    const attempt = method === 'POST' ? agent.post(path) : method === 'PUT' ? agent.put(path) : agent.get(path);
    attempt.set(f.as(f.other)); if (body) attempt.send(body);
    const response = await attempt;
    expect(response.status).toBe(404); expect(response.body).toEqual({ error: 'endpoint_not_found' });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.repository.recordCheck).not.toHaveBeenCalled(); expect(f.repository.saveSchedule).not.toHaveBeenCalled();
  });
  it('filters listings and assigns only the authenticated owner on registration', async () => {
    const f = await fixture();
    expect((await request(f.app).get('/api/endpoints').set(f.as(f.other))).body.endpoints).toEqual([]);
    expect((await request(f.app).get('/api/endpoints').set(f.as(f.owner))).body.endpoints).toHaveLength(1);
    const response = await request(f.app).post('/api/endpoints').set(f.as(f.owner)).send({ name: 'New', url: f.endpoint.url });
    expect(response.status).toBe(201); expect(f.repository.createEndpoint).toHaveBeenCalledWith({ name: 'New', url: f.endpoint.url, ownerId: f.owner.user.id });
    expect((await request(f.app).post('/api/endpoints').set(f.as(f.owner)).send({ name: 'New', url: f.endpoint.url, ownerId: f.other.user.id })).status).toBe(400);
  });
  it('hides unclaimed legacy records even from a valid registered user', async () => {
    const f = await fixture(); f.endpoint.ownerId = null;
    expect((await request(f.app).get(`/api/endpoints/${id}`).set(f.as(f.owner))).status).toBe(404);
    expect((await request(f.app).get('/api/endpoints').set(f.as(f.owner))).body.endpoints).toEqual([]);
  });
  it('requires the current session CSRF token for monitoring writes', async () => {
    const f = await fixture();
    const response = await request(f.app).post(`/api/endpoints/${id}/checks`).set({ ...f.as(f.owner), 'X-CSRF-Token': f.other.csrfToken }).send({});
    expect(response.status).toBe(403); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('allows an owner check and preserves the trusted internal worker interface without sessions', async () => {
    const f = await fixture();
    expect((await request(f.app).post(`/api/endpoints/${id}/checks`).set(f.as(f.owner)).send({})).status).toBe(201);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    // Internal calls are not HTTP routes. Existing worker tests cover schedule execution and coordination.
    f.endpoint.ownerId = null;
    expect((await f.service.check(id)).check.outcome).toBe('success');
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });
});
