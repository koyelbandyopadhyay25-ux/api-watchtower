import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { SESSION_SECONDS, sessionHash } from '../src/auth/auth-service.js';
import type { MonitoringService } from '../src/monitoring/monitoring-service.js';
import { authFixture } from './helpers/auth-fixture.js';

const password = 'Test-only password with sufficient length';
const email = 'person@example.test';
const headers = { 'X-Watchtower-Local': '1', Origin: 'http://localhost:5173' };
function httpFixture(secure = false) {
  const auth = authFixture();
  const monitoring = { list: vi.fn(async () => []), register: vi.fn() } as unknown as MonitoringService;
  const app = createApp({ monitoring, authentication: auth.service, environment: { NODE_ENV: 'development', ENABLE_LOCAL_MANAGEMENT: 'true', AUTH_COOKIE_SECURE: String(secure) } });
  return { ...auth, app, monitoring };
}

describe('Argon2id and server-managed sessions', () => {
  it('normalizes email, stores an actual Argon2id hash, and never returns password metadata', async () => {
    const { service, users } = authFixture();
    const result = await service.register({ email: ` ${email.toUpperCase()} `, password });
    const saved = users.get(email)!;
    expect(saved.passwordHash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(new Set(saved.passwordHash.split('$')[3]!.split(','))).toEqual(new Set(['m=19456', 't=2', 'p=1']));
    expect(await argon2.verify(saved.passwordHash, password)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('password');
  });
  it('handles duplicate registration generically without replacing a password', async () => {
    const { service, users } = authFixture();
    const first = await service.register({ email, password }); const hash = users.get(email)!.passwordHash;
    expect(await service.register({ email, password: 'A different test-only password' })).toEqual(first);
    expect(users.get(email)!.passwordHash).toBe(hash);
  });
  it.each([null, {}, { email, password: 'short' }, { email, password, ownerId: 'forged' }, { email: 'invalid', password }])('rejects malformed credentials case %#', async input => {
    await expect(authFixture().service.register(input)).rejects.toMatchObject({ status: 400 });
  });
  it('uses indistinguishable errors for missing users and incorrect passwords', async () => {
    const { service } = authFixture(); await service.register({ email, password });
    await expect(service.login({ email, password: 'Incorrect password, test only' })).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    await expect(service.login({ email: 'missing@example.test', password })).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
  });
  it('stores only a digest, creates random identifiers, and rotates the presented session', async () => {
    const { service, sessions } = authFixture(); await service.register({ email, password });
    const first = await service.login({ email, password });
    expect(first.token).toHaveLength(43); expect(sessions.has(first.token)).toBe(false);
    expect(sessions.has(sessionHash(first.token))).toBe(true);
    const second = await service.login({ email, password }, first.token);
    expect(second.token).not.toBe(first.token); expect(second.csrfToken).not.toBe(first.csrfToken);
    await expect(service.authenticate(first.token)).rejects.toMatchObject({ status: 401 });
  });
  it('enforces absolute expiry at eight hours with a controlled clock', async () => {
    const { service, advance } = authFixture(); await service.register({ email, password });
    const session = await service.login({ email, password });
    advance(SESSION_SECONDS * 1000 - 1); expect((await service.authenticate(session.token)).user.email).toBe(email);
    advance(1); await expect(service.authenticate(session.token)).rejects.toMatchObject({ status: 401 });
  });
  it('invalidates logout and rejects missing, malformed, and forged tokens', async () => {
    const { service } = authFixture(); await service.register({ email, password });
    const session = await service.login({ email, password }); await service.logout(session.token);
    for (const token of [undefined, 'forged', randomBytes(32).toString('base64url'), session.token]) await expect(service.authenticate(token)).rejects.toMatchObject({ status: 401 });
  });
});

describe('authentication HTTP boundary', () => {
  it('fails closed without an authentication dependency', async () => {
    const app = createApp({ monitoring: {} as MonitoringService, environment: { NODE_ENV: 'development', ENABLE_LOCAL_MANAGEMENT: 'true' } });
    expect((await request(app).get('/api/endpoints').set(headers)).status).toBe(401);
    expect((await request(app).get('/api/endpoints').set(headers).set('Authorization', `Bearer ${'a'.repeat(43)}`)).status).toBe(401);
  });
  it('rejects unauthenticated and forged-cookie endpoint access', async () => {
    const { app, monitoring } = httpFixture();
    expect((await request(app).get('/api/endpoints').set(headers)).status).toBe(401);
    expect((await request(app).get('/api/endpoints').set(headers).set('Cookie', `watchtower_session=${'a'.repeat(43)}`)).status).toBe(401);
    expect(monitoring.list).not.toHaveBeenCalled();
  });
  it('registers, logs in with an HttpOnly cookie, restores, rejects CSRF, and invalidates logout', async () => {
    const { app } = httpFixture();
    expect((await request(app).post('/api/auth/register').set(headers).send({ email, password })).status).toBe(202);
    const logged = await request(app).post('/api/auth/login').set(headers).send({ email, password });
    expect(logged.status).toBe(200); expect(logged.body.token).toBeUndefined();
    const cookie = logged.headers['set-cookie']![0] as string;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Path=/api'); expect(cookie).not.toContain('Secure');
    const bearer = cookie.split(';')[0]!;
    expect((await request(app).get('/api/auth/session').set(headers).set('Cookie', `${bearer}; ${bearer}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/session').set(headers).set('Cookie', bearer)).body.user.email).toBe(email);
    for (const csrf of [undefined, 'x'.repeat(43)]) {
      const attempt = request(app).post('/api/auth/logout').set(headers).set('Cookie', bearer);
      if (csrf) attempt.set('X-CSRF-Token', csrf);
      expect((await attempt.send({})).status).toBe(403);
    }
    const out = await request(app).post('/api/auth/logout').set(headers).set('Cookie', bearer).set('X-CSRF-Token', logged.body.csrfToken).send({});
    expect(out.status).toBe(200); expect(out.headers['set-cookie']![0]).toContain('Max-Age=0');
    expect((await request(app).get('/api/auth/session').set(headers).set('Cookie', bearer)).status).toBe(401);
  });
  it('uses Secure cookies when the development HTTP exception is not configured', async () => {
    const { app, service } = httpFixture(true); await service.register({ email, password });
    const response = await request(app).post('/api/auth/login').set(headers).send({ email, password });
    expect(response.headers['set-cookie']![0]).toContain('Secure');
  });
  it('protects pre-login requests with Origin, JSON and the local custom header', async () => {
    const { app } = httpFixture();
    expect((await request(app).post('/api/auth/login').set('X-Watchtower-Local', '1').send({ email, password })).status).toBe(403);
    expect((await request(app).post('/api/auth/login').set({ ...headers, Origin: 'http://attacker.example' }).send({ email, password })).status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ email, password })).status).toBe(403);
    expect((await request(app).post('/api/auth/login').set(headers).type('form').send({ email, password })).status).toBe(415);
  });
  it('rate limits login independently of account existence', async () => {
    const { app } = httpFixture();
    for (let count = 0; count < 10; count++) expect((await request(app).post('/api/auth/login').set(headers).send({ email, password })).status).toBe(401);
    const blocked = await request(app).post('/api/auth/login').set(headers).send({ email, password });
    expect(blocked.status).toBe(429); expect(blocked.headers['retry-after']).toBeDefined();
  });
});
