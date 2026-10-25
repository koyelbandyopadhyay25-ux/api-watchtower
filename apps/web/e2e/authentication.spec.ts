import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';
import { test, expect } from '@playwright/test';
import { registerBrowserUser, loginBrowserUser } from './authentication';

test.skip(process.env.WATCHTOWER_LIVE_E2E !== 'true', 'Requires the explicitly enabled local authenticated stack.');

/** Shorten ONLY this test's new session; never alter monitoring/history or global clocks. */
async function expireOwnDemoSession(token: string, userId: string) {
  const environment = dotenv.parse(await readFile(resolve('../api/.env')));
  const url = new URL(environment.DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || url.port !== '5432' || url.pathname !== '/watchtower_dev') throw new Error('Live expiry target mismatch.');
  const client = new pg.Client({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const identity = (await client.query('SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
    if (identity.name !== 'watchtower_dev' || identity.host !== '127.0.0.1' || identity.port !== 5432) throw new Error();
    const result = await client.query(`UPDATE "Session" SET "expiresAt" = clock_timestamp() + interval '1 second'
      WHERE "tokenHash" = $1 AND "userId" = $2::uuid AND "createdAt" > clock_timestamp() - interval '5 minutes'`, [createHash('sha256').update(token).digest('hex'), userId]);
    if (result.rowCount !== 1) throw new Error();
  } catch { throw new Error('Scoped demo-session expiry verification failed. No credentials logged.'); }
  finally { await client.end(); }
}

test('real cookie sessions, two-user isolation, legacy refusal, CSRF, logout and expiry', async ({ page, context, browser }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const headers = { 'X-Watchtower-Local': '1', Origin: 'http://localhost:5173' };
  const credentialsA = await registerBrowserUser(page, 'A');
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await registerBrowserUser(otherPage, 'B');
    const sessionA = (await (await context.request.get('/api/auth/session', { headers })).json());
    const sessionB = (await (await otherContext.request.get('http://localhost:5173/api/auth/session', { headers })).json());
    expect(sessionA.user.id === sessionB.user.id).toBe(false);
    const localCookie = (await context.cookies('http://localhost:5173/api')).find(cookie => cookie.name === 'watchtower_session');
    expect(Boolean(localCookie?.httpOnly)).toBe(true); expect(localCookie?.sameSite).toBe('Strict'); expect(localCookie?.secure).toBe(false);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    const writeA = { ...headers, 'X-CSRF-Token': sessionA.csrfToken };
    const writeB = { ...headers, 'X-CSRF-Token': sessionB.csrfToken };
    const registration = await context.request.post('/api/endpoints', { headers: writeA, data: { name: 'Phase 6A ownership verification', url: 'https://jsonplaceholder.typicode.com/todos/1' } });
    expect(registration.status()).toBe(201);
    const endpoint = await registration.json(); const route = `/api/endpoints/${endpoint.id}`;
    expect((await context.request.post(route + '/checks', { headers: writeA, data: {} })).status()).toBe(201);
    const previous = await (await context.request.get(route + '/checks', { headers })).json();
    for (const suffix of ['', '/checks', '/schedule', '/scheduled-checks']) {
      expect((await otherContext.request.get('http://localhost:5173' + route + suffix, { headers })).status()).toBe(404);
    }
    expect((await otherContext.request.post('http://localhost:5173' + route + '/checks', { headers: writeB, data: {} })).status()).toBe(404);
    expect((await otherContext.request.put('http://localhost:5173' + route + '/baseline', { headers: writeB, data: { accept: true, expectedUpdatedAt: endpoint.updatedAt } })).status()).toBe(404);
    expect((await otherContext.request.put('http://localhost:5173' + route + '/schedule', { headers: writeB, data: { enabled: true, intervalMinutes: 5 } })).status()).toBe(404);
    expect((await (await otherContext.request.get('http://localhost:5173/api/endpoints', { headers })).json()).endpoints.some((row: { id: string }) => row.id === endpoint.id)).toBe(false);
    for (const token of [undefined, 'x'.repeat(43), sessionB.csrfToken]) {
      const attemptHeaders = token ? { ...headers, 'X-CSRF-Token': token } : headers;
      expect((await context.request.post(route + '/checks', { headers: attemptHeaders, data: {} })).status()).toBe(403);
      expect((await context.request.put(route + '/schedule', { headers: attemptHeaders, data: { enabled: true, intervalMinutes: 5 } })).status()).toBe(403);
    }
    expect((await (await context.request.get(route + '/checks', { headers })).json()).checks.length).toBe(previous.checks.length);
    expect((await (await context.request.get(route, { headers })).json()).baselineSchema).toBeNull();
    const snapshot = JSON.parse(await readFile('artifacts/phase6a-development-before.json', 'utf8')) as { snapshot: { Endpoint: { rows: { id: string }[] } } };
    expect(snapshot.snapshot.Endpoint.rows).toHaveLength(9);
    for (const legacy of snapshot.snapshot.Endpoint.rows) {
      expect((await context.request.get(`/api/endpoints/${legacy.id}`, { headers })).status()).toBe(404);
      expect((await otherContext.request.get(`http://localhost:5173/api/endpoints/${legacy.id}`, { headers })).status()).toBe(404);
    }
    await page.reload(); await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    expect((await context.request.get('/api/auth/session', { headers })).status()).toBe(401);
    const revokedContext = await browser.newContext();
    try {
      await revokedContext.addCookies([localCookie!]);
      expect((await revokedContext.request.get('http://localhost:5173/api/auth/session', { headers })).status()).toBe(401);
    } finally { await revokedContext.close(); }
    await loginBrowserUser(page, credentialsA);
    const renewed = await (await context.request.get('/api/auth/session', { headers })).json();
    const ownCookie = (await context.cookies('http://localhost:5173/api')).find(cookie => cookie.name === 'watchtower_session')!;
    await expireOwnDemoSession(ownCookie.value, renewed.user.id);
    await page.waitForTimeout(1500);
    expect((await context.request.get('/api/auth/session', { headers })).status()).toBe(401);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    await mkdir('artifacts', { recursive: true });
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.screenshot({ path: 'artifacts/authentication-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/authentication-mobile.png', fullPage: true });
    console.log(`Two-user live isolation verified; owned endpoint ${endpoint.id}; all 9 legacy endpoints refused; scoped session expiry and logout enforced.`);
    // Revoke the demonstration's expired session, without altering its account/history.
    await loginBrowserUser(page, credentialsA);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await otherPage.getByRole('button', { name: 'Sign out', exact: true }).click();
  } finally { await otherContext.close(); }
});
