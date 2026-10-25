import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { registerBrowserUser, loginBrowserUser } from './authentication';

test.skip(process.env.WATCHTOWER_LIVE_E2E !== 'true', 'Requires the real opted-in local stack and PostgreSQL.');

test('dashboard persists settings and controls a real independent worker', async ({ page, browser }) => {
  const request = page.request; // An isolated API request fixture has no browser login cookie.
  test.setTimeout(100_000);
  const headers = { 'X-Watchtower-Local': '1' };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const name = `Scheduling verification ${new Date().toISOString()}`;
  let id: string | null = null;
  let worker: ChildProcess | null = null;
  let workerLog = '';
  let csrfToken = '';
  let credentials: { email: string; password: string } | undefined;
  const settings = () => page.getByRole('region', { name: 'Monitoring settings', exact: true });
  async function save() {
    await settings().getByRole('button', { name: 'Save monitoring settings' }).click();
  }
  async function enable() {
    await settings().getByLabel('Enable automatic monitoring').check();
    await save();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm enablement' }).click();
    await expect(settings().getByTestId('saved-schedule')).toHaveText(/Enabled/);
    await expect(settings().getByRole('button', { name: 'Refresh settings' })).toBeEnabled();
  }
  async function runs() {
    const response = await request.get(`/api/endpoints/${id}/scheduled-checks`, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json()).runs as { checkResult: { httpStatus: number; outcome: string } }[];
  }
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    credentials = await registerBrowserUser(page);
    const session = await request.get('/api/auth/session', { headers });
    expect(session.ok()).toBe(true); csrfToken = (await session.json()).csrfToken;
    await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
    await page.getByLabel('Endpoint name').fill(name);
    await page.getByRole('button', { name: 'Todo', exact: true }).click();
    await page.getByRole('button', { name: 'Register endpoint' }).click();
    await page.getByRole('link', { name, exact: true }).click();
    id = page.url().split('/').at(-1)!;
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    await expect(settings().getByTestId('saved-schedule')).toHaveText(/Disabled/);
    await settings().getByLabel('Frequency').selectOption('5');
    await settings().getByLabel('Enable automatic monitoring').check();
    await save();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(settings().getByRole('button', { name: 'Save monitoring settings' })).toBeFocused();
    await expect(settings().getByTestId('saved-schedule')).toHaveText(/Disabled/);

    // First enablement is immediately due. Disable BEFORE starting the worker,
    // proving disabled due work is skipped without backdating or short intervals.
    await enable();
    await settings().getByLabel('Enable automatic monitoring').uncheck();
    await save();
    await expect(settings().getByTestId('saved-schedule')).toHaveText(/Disabled/);
    worker = spawn(process.execPath, ['dist/worker/main.js'], {
      cwd: resolve('../api'), windowsHide: true,
      env: { ...process.env, NODE_ENV: 'development', ENABLE_SCHEDULER_WORKER: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout!.on('data', chunk => { workerLog += String(chunk); });
    worker.stderr!.on('data', chunk => { workerLog += String(chunk); });
    await expect.poll(() => workerLog, { timeout: 15_000 }).toContain('worker_started');
    const until = Date.now() + 12_000;
    do {
      expect(await runs()).toHaveLength(0);
      await page.waitForTimeout(1000);
    } while (Date.now() < until);

    // Stop our worker before enablement, so the new due check cannot begin until AFTER logout.
    { const exited = once(worker, 'exit'); worker.kill(); await exited; worker = null; }
    await enable();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    expect((await request.get('/api/endpoints', { headers })).status()).toBe(401);
    workerLog = '';
    worker = spawn(process.execPath, ['dist/worker/main.js'], {
      cwd: resolve('../api'), windowsHide: true,
      env: { ...process.env, NODE_ENV: 'development', ENABLE_SCHEDULER_WORKER: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout!.on('data', chunk => { workerLog += String(chunk); });
    worker.stderr!.on('data', chunk => { workerLog += String(chunk); });
    await expect.poll(() => workerLog, { timeout: 25_000 }).toContain('scheduled_check_saved');
    await loginBrowserUser(page, credentials);
    csrfToken = (await (await request.get('/api/auth/session', { headers })).json()).csrfToken;
    await page.goto(`/#endpoints/${id}`);
    await expect.poll(async () => (await runs()).length, { timeout: 25_000 }).toBe(1);
    const actual = (await runs())[0]!;
    expect(actual.checkResult.httpStatus).toBe(200);
    expect(actual.checkResult.outcome).toBe('success');
    await page.getByRole('button', { name: 'Refresh detail' }).click();
    await expect(page.getByRole('table', { name: 'Persisted checks, newest first' }).getByText('Scheduled', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Persisted checks, newest first' }).getByText('Manual', { exact: true })).toBeVisible();
    await expect(settings().getByLabel('Frequency')).toBeEnabled();
    await settings().getByLabel('Frequency').selectOption('15');
    await save();
    await expect(settings().getByTestId('saved-schedule')).toHaveText(/Enabled · Every 15/);
    await page.reload();
    await expect(settings().getByTestId('saved-schedule')).toHaveText(/Enabled · Every 15/);
    const context = await browser.newContext();
    const reopened = await context.newPage();
    await reopened.goto(page.url());
    await loginBrowserUser(reopened, credentials);
    await expect(reopened.getByTestId('saved-schedule')).toHaveText(/Enabled · Every 15/);
    await reopened.getByRole('button', { name: 'Sign out', exact: true }).click();
    await context.close();
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/scheduling-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/scheduling-mobile.png', fullPage: true });
    expect(errors).toEqual([]);
    console.log(`Real scheduling endpoint: ${id}; scheduled HTTP ${actual.checkResult.httpStatus}; disabled due work skipped for 12 seconds.`);
  } finally {
    try {
      if (id) {
        const active = await request.get('/api/auth/session', { headers });
        if (active.status() === 401 && credentials) {
          const login = await request.post('/api/auth/login', { headers: { ...headers, Origin: 'http://localhost:5173' }, data: credentials });
          expect(login.status()).toBe(200); csrfToken = (await login.json()).csrfToken;
        }
        // A bounded in-flight check can temporarily own the configuration lock.
        await expect.poll(async () => (await request.put(`/api/endpoints/${id}/schedule`, {
          headers: { ...headers, 'X-CSRF-Token': csrfToken }, data: { enabled: false, intervalMinutes: 15 },
        })).status(), { timeout: 15_000 }).toBe(200);
        expect((await request.post('/api/auth/logout', { headers: { ...headers, Origin: 'http://localhost:5173', 'X-CSRF-Token': csrfToken }, data: {} })).status()).toBe(200);
      }
    } finally {
      if (worker && worker.exitCode === null) {
        const exited = once(worker, 'exit'); worker.kill(); await exited;
      }
    }
  }
});
