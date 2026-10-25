import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { registerBrowserUser } from './authentication';

test.skip(process.env.WATCHTOWER_LIVE_E2E !== 'true' || process.env.WATCHTOWER_MAILPIT_TEST !== 'true', 'Explicit local browser and Mailpit opt-in required.');

test('notification settings, actual timeout/recovery, capture, retry and dispatcher restart', async ({ page }) => {
  test.setTimeout(120_000);
  const request = page.request;
  const local = { 'X-Watchtower-Local': '1' };
  const origin = { ...local, Origin: 'http://localhost:5173' };
  const apiDirectory = resolve('../api');
  const mailpitPath = resolve('artifacts/tools/mailpit-v1.32.0/mailpit.exe');
  const evidence: Record<string, unknown> = {};
  let mailpit: ChildProcess | undefined;
  let id: string | undefined;
  let csrfToken: string | undefined;

  function child(args: string[], extra: NodeJS.ProcessEnv = {}) {
    const result = spawnSync(process.execPath, args, { cwd: apiDirectory, windowsHide: true, encoding: 'utf8', timeout: 25_000,
      env: { ...process.env, NODE_ENV: 'development', ...extra } });
    expect(result.status, 'Owned verification process must exit successfully').toBe(0);
    return result.stdout;
  }
  function check(mode: 'timeout' | 'normal') {
    return JSON.parse(child(['../../node_modules/tsx/dist/cli.mjs', 'scripts/notification-demo-check.ts', id!, mode], { WATCHTOWER_NOTIFICATION_DEMO: 'true' }).trim());
  }
  function dispatch() {
    return child(['dist/notifications/main.js', '--once'], { ENABLE_EMAIL_DISPATCHER: 'true', EMAIL_DELIVERY_MODE: 'mailpit', MAILPIT_SMTP_HOST: '127.0.0.1', MAILPIT_SMTP_PORT: '1025' });
  }
  async function history() {
    const response = await request.get(`/api/endpoints/${id}/notifications`, { headers: local });
    expect(response.status()).toBe(200); return (await response.json()).events;
  }
  async function startMailpit() {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MP_')));
    mailpit = spawn(mailpitPath, ['--smtp', '127.0.0.1:1025', '--listen', '127.0.0.1:8025', '--database', resolve('artifacts/mailpit.db'), '--max', '0', '--disable-version-check', '--smtp-disable-rdns', '--allowed-hosts', 'localhost,127.0.0.1', '--smtp-allowed-recipients', '^watchtower\\+[0-9a-f-]{36}@example\\.test$'], { env, windowsHide: true, stdio: 'ignore' });
    await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:8025/api/v1/messages')).ok; } catch { return false; } }).toBe(true);
  }
  async function stopMailpit() {
    if (mailpit && mailpit.exitCode === null) { const exited = once(mailpit, 'exit'); mailpit.kill(); await exited; }
    mailpit = undefined;
  }
  try {
    await registerBrowserUser(page);
    csrfToken = (await (await request.get('/api/auth/session', { headers: local })).json()).csrfToken;
    const name = `Phase 6B notification verification ${new Date().toISOString()}`;
    await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
    await page.getByLabel('Endpoint name').fill(name);
    await page.getByRole('button', { name: 'Todo', exact: true }).click();
    await page.getByRole('button', { name: 'Register endpoint' }).click();
    await page.getByRole('link', { name, exact: true }).click();
    id = page.url().split('/').at(-1)!;
    const panel = page.getByRole('region', { name: 'Notifications and incidents', exact: true });
    await expect(panel.getByTestId('saved-notifications')).toHaveText('Saved notifications: Disabled');
    expect((await request.put(`/api/endpoints/${id}/notification-settings`, { headers: origin, data: { enabled: true, expectedUpdatedAt: null } })).status()).toBe(403);
    await panel.getByLabel('Enable local email notifications').check();
    await panel.getByRole('button', { name: 'Save notifications', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Enable local notifications?' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm notifications' }).click();
    await expect(panel.getByText('Notification settings saved.')).toBeVisible();
    await page.reload();
    await expect(panel.getByTestId('saved-notifications')).toHaveText('Saved notifications: Enabled');

    // Mailpit is deliberately stopped: real SMTP failure must persist a retry.
    const failure = check('timeout'); expect(failure.outcome).toBe('network_error'); expect(failure.errorCode).toBe('timeout');
    check('timeout'); expect(await history()).toHaveLength(1);
    expect(dispatch()).toContain('email_attempt_failed');
    const failedAttempt = (await history())[0];
    expect(failedAttempt.outbox.state).toBe('pending');
    expect(failedAttempt.outbox.deliveries[0].state).toBe('retry_scheduled');
    evidence.retryBeforeRestart = { eventId: failedAttempt.id, state: failedAttempt.outbox.state, attempts: failedAttempt.outbox.attempts };
    await startMailpit();
    // A new dispatcher process respects the persisted backoff; no time rewriting.
    await expect.poll(() => { dispatch(); return history().then(events => events[0].outbox.state); }, { timeout: 45_000, intervals: [2000] }).toBe('smtp_accepted');
    const recovered = check('normal'); expect(recovered.outcome).toBe('success'); expect(recovered.httpStatus).toBe(200);
    expect(dispatch()).toContain('email_smtp_accepted');
    const events = await history();
    expect(events).toHaveLength(2); expect(events.map((event: { kind: string }) => event.kind).sort()).toEqual(['failure', 'recovery']);
    expect(events.every((event: { outbox: { state: string } }) => event.outbox.state === 'smtp_accepted')).toBe(true);
    const messages = await (await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
    const captures = [];
    for (const message of messages.messages) {
      const full = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`)).json();
      if (events.some((event: { id: string }) => full.MessageID?.includes(event.id))) {
        expect(full.To.every((recipient: { Address: string }) => /^watchtower\+[0-9a-f-]{36}@example\.test$/.test(recipient.Address))).toBe(true);
        expect(full.Text).toContain(name); captures.push({ id: full.ID, messageId: full.MessageID, subject: full.Subject, to: full.To, text: full.Text });
      }
    }
    expect(captures).toHaveLength(2);
    evidence.endpointId = id; evidence.events = events; evidence.captures = captures;
    await panel.getByRole('button', { name: 'Refresh notifications' }).click();
    await expect(panel.getByText('SMTP accepted (Mailpit)', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Failure opened', { exact: true })).toBeVisible();
    await expect(panel.getByText('Availability recovered', { exact: true })).toBeVisible();
    await mkdir('artifacts', { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: 'artifacts/notifications-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/notifications-mobile.png', fullPage: true });
    await panel.getByLabel('Enable local email notifications').uncheck();
    await panel.getByRole('button', { name: 'Save notifications', exact: true }).click();
    await expect(panel.getByTestId('saved-notifications')).toHaveText('Saved notifications: Disabled');
    check('timeout'); dispatch();
    expect((await history()).filter((event: { outbox: unknown }) => event.outbox === null)).toHaveLength(1);
    const after = await (await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
    expect(after.total).toBe(messages.total);
    evidence.disabledNoNewEmail = true;
    await writeFile('artifacts/phase6b-live-notifications.json', JSON.stringify(evidence, null, 2));
    const inbox = await page.context().newPage(); await inbox.goto('http://127.0.0.1:8025');
    await inbox.screenshot({ path: 'artifacts/mailpit-capture.png', fullPage: true }); await inbox.close();
  } finally {
    if (id && csrfToken) {
      const response = await request.get(`/api/endpoints/${id}/notification-settings`, { headers: local });
      if (response.ok()) { const settings = await response.json(); expect((await request.put(`/api/endpoints/${id}/notification-settings`, { headers: { ...origin, 'X-CSRF-Token': csrfToken }, data: { enabled: false, expectedUpdatedAt: settings.updatedAt } })).status()).toBe(200); }
    }
    await stopMailpit();
    if (await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible()) await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  }
});
