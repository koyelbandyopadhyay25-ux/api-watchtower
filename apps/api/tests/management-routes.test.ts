import { authenticatedRequest as request, testAuthentication, testUserId } from './helpers/authenticated-request.js';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { MonitoringService } from '../src/monitoring/monitoring-service.js';

const id = '11111111-1111-4111-8111-111111111111';
function fixture(environment: NodeJS.ProcessEnv = { NODE_ENV: 'development', ENABLE_LOCAL_MANAGEMENT: 'true' }) {
  const service = {
    register: vi.fn(async input => ({ id, ...input, baselineSchema: null })),
    list: vi.fn(async () => []), get: vi.fn(async () => ({ id })),
    check: vi.fn(async () => ({ check: { id: 'check' }, comparison: 'baseline_missing' })),
    acceptBaseline: vi.fn(async () => ({ endpoint: { id } })), history: vi.fn(async () => []),
    schedule: vi.fn(async () => ({ endpointId: id, enabled: false, intervalMinutes: 15, nextRunAt: null })),
    configureSchedule: vi.fn(async (_id: string, enabled: boolean, intervalMinutes: number) => ({ endpointId: id, enabled, intervalMinutes })),
    scheduledHistory: vi.fn(async () => []),
  };
  return { app: createApp({ monitoring: service as unknown as MonitoringService, authentication: testAuthentication, environment }), service };
}

describe('local development management API', () => {
  it.each([
    { NODE_ENV: 'production', ENABLE_LOCAL_MANAGEMENT: 'true' },
    { NODE_ENV: 'development', ENABLE_LOCAL_MANAGEMENT: 'false' },
    { ENABLE_LOCAL_MANAGEMENT: 'true' },
  ])('does not mount management routes when not explicitly enabled in development (%j)', async env => {
    const { app } = fixture(env);
    expect((await request(app).get('/api/endpoints').set('X-Watchtower-Local', '1')).status).toBe(404);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('requires the custom local header even on reads', async () => {
    expect((await request(fixture().app).get('/api/endpoints')).status).toBe(403);
  });

  it.each([
    ['Host', 'attacker.example'], ['Origin', 'https://attacker.example'],
    ['Origin', 'null'], ['X-Forwarded-For', '127.0.0.1'], ['Forwarded', 'for=127.0.0.1'],
    ['Host', 'attacker@localhost'], ['X-Forwarded-Proto', 'https'],
  ])('rejects hostile or forwarded %s headers', async (header, value) => {
    expect((await request(fixture().app).get('/api/endpoints').set('X-Watchtower-Local', '1').set(header, value)).status).toBe(403);
  });

  it('lists endpoints and history with bounded limits', async () => {
    const { app, service } = fixture();
    expect((await request(app).get('/api/endpoints?limit=10').set('X-Watchtower-Local', '1')).body).toEqual({ endpoints: [] });
    expect(service.list).toHaveBeenCalledWith(10, testUserId);
    expect((await request(app).get(`/api/endpoints/${id}/checks`).set('X-Watchtower-Local', '1')).body).toEqual({ checks: [] });
    expect(service.history).toHaveBeenCalledWith(id, 50, testUserId);
  });

  it.each(['0', '101', 'bad', '1.5'])('rejects invalid history limit %s', async limit => {
    expect((await request(fixture().app).get(`/api/endpoints/${id}/checks?limit=${limit}`).set('X-Watchtower-Local', '1')).status).toBe(400);
  });

  it('registers endpoints and runs manual checks', async () => {
    const { app, service } = fixture();
    const registered = await request(app).post('/api/endpoints').set('X-Watchtower-Local', '1').send({ name: 'Todo', url: 'https://jsonplaceholder.typicode.com/todos/1' });
    expect(registered.status).toBe(201);
    expect(registered.body.baselineSchema).toBeNull();
    expect((await request(app).post(`/api/endpoints/${id}/checks`).set('X-Watchtower-Local', '1').send({})).status).toBe(201);
    expect(service.check).toHaveBeenCalledWith(id, testUserId);
  });

  it('normalizes UUID casing before endpoint concurrency checks', async () => {
    const { app, service } = fixture();
    const uppercase = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    expect((await request(app).post(`/api/endpoints/${uppercase}/checks`).set('X-Watchtower-Local', '1').send({})).status).toBe(201);
    expect(service.check).toHaveBeenCalledWith(uppercase.toLowerCase(), testUserId);
  });

  it('requires explicit baseline acceptance and the current ISO timestamp', async () => {
    const { app, service } = fixture();
    const route = `/api/endpoints/${id}/baseline`;
    expect((await request(app).put(route).set('X-Watchtower-Local', '1').send({ accept: true })).status).toBe(400);
    const updatedAt = '2026-01-01T00:00:00.000Z';
    expect((await request(app).put(route).set('X-Watchtower-Local', '1').send({ accept: true, expectedUpdatedAt: updatedAt })).status).toBe(200);
    expect(service.acceptBaseline).toHaveBeenCalledWith(id, updatedAt, testUserId);
  });

  it('rejects invalid UUIDs, extra fields, oversized and malformed bodies', async () => {
    const { app } = fixture();
    expect((await request(app).get('/api/endpoints/invalid').set('X-Watchtower-Local', '1')).status).toBe(400);
    expect((await request(app).post(`/api/endpoints/${id}/checks`).set('X-Watchtower-Local', '1').send({ headers: { Authorization: 'secret' } })).status).toBe(400);
    expect((await request(app).post('/api/endpoints').set('X-Watchtower-Local', '1').send({ name: 'x'.repeat(9000) })).status).toBe(413);
    expect((await request(app).post('/api/endpoints').set('X-Watchtower-Local', '1').type('json').send('{')).status).toBe(400);
    expect((await request(app).post('/api/endpoints').set('X-Watchtower-Local', '1').type('text').send('x')).status).toBe(415);
  });

  it('does not expose raw errors or secret details', async () => {
    const { app, service } = fixture();
    service.list.mockRejectedValueOnce(new Error('password=secret'));
    const response = await request(app).get('/api/endpoints').set('X-Watchtower-Local', '1');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal_error' });
  });

  it('uses the existing local boundary for schedule configuration and provenance', async () => {
    const { app, service } = fixture();
    expect((await request(app).get(`/api/endpoints/${id}/schedule`)).status).toBe(403);
    const initial = await request(app).get(`/api/endpoints/${id}/schedule`).set('X-Watchtower-Local', '1');
    expect(initial.body.enabled).toBe(false);
    const changed = await request(app).put(`/api/endpoints/${id}/schedule`).set('X-Watchtower-Local', '1').send({ enabled: true, intervalMinutes: 5 });
    expect(changed.status).toBe(200);
    expect(service.configureSchedule).toHaveBeenCalledWith(id, true, 5, testUserId);
    expect((await request(app).get(`/api/endpoints/${id}/scheduled-checks`).set('X-Watchtower-Local', '1')).body).toEqual({ runs: [] });
  });

  it.each([{ enabled: true, intervalMinutes: 1 }, { enabled: 'true', intervalMinutes: 5 },
    { enabled: true, intervalMinutes: 5, nextRunAt: 'arbitrary' }, { enabled: false }])('rejects invalid schedule settings (%j)', async input => {
    expect((await request(fixture().app).put(`/api/endpoints/${id}/schedule`).set('X-Watchtower-Local', '1').send(input)).status).toBe(400);
  });
});
