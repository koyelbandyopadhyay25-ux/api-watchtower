import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { registerBrowserUser } from './authentication';

// Explicit opt-in: this makes actual public GET requests and leaves real dev history.
test.skip(process.env.WATCHTOWER_LIVE_E2E !== 'true', 'Start the local stack and explicitly enable live verification.');

test('complete dashboard workflow through the real Vite proxy, API, and PostgreSQL', async ({ page }) => {
  test.setTimeout(90_000);
  const request = page.request; // Shares the browser's HttpOnly cookie jar.
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  const localHeaders = { 'X-Watchtower-Local': '1' };
  expect((await request.get('/api/endpoints?limit=1', { headers: localHeaders })).status()).toBe(401);
  await registerBrowserUser(page);
  expect((await request.get('/api/endpoints?limit=1', { headers: localHeaders })).status()).toBe(200);
  expect((await request.get('/api/endpoints')).status()).toBe(403);
  expect((await request.get('/api/endpoints', { headers: { ...localHeaders, Origin: 'https://attacker.example' } })).status()).toBe(403);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const name = `Dashboard verification ${new Date().toISOString()}`;
  await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
  await page.getByLabel('Endpoint name').fill(name);
  await page.getByRole('button', { name: 'Todo', exact: true }).click();
  await page.getByRole('button', { name: 'Register endpoint' }).click();
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('No checks recorded', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(page.getByText('Check saved. No baseline has been accepted, so no schema comparison was made.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Persisted checks, newest first' }).getByText('200', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Capture baseline' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Accept baseline' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Accept baseline' }).click();
  await expect(page.getByText('Baseline accepted from a fresh response. The capture check is saved in history.')).toBeVisible();
  await expect(page.getByText('View saved schema')).toBeVisible();

  let storedChecks = 2;
  let compared = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = page.waitForResponse(result => result.request().method() === 'POST' && result.url().endsWith('/checks'));
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    const recorded = await response; expect(recorded.status()).toBe(201);
    const result = await recorded.json(); storedChecks++;
    if (result.check.outcome === 'success') {
      expect(result.comparison).toBe('compared'); compared = true;
      await expect(page.getByText('Check saved. No structural changes were detected for this sample.')).toBeVisible();
      break;
    }
    // An actual upstream failure is retained and verified, never relabeled success.
    await expect(page.getByText(/Check saved as failed:/)).toBeVisible();
    console.log(`Real manual check saved as ${result.check.outcome}: ${result.check.errorCode}; one fresh attempt remains at most.`);
  }
  expect(compared).toBe(true);
  await expect(page.getByRole('table', { name: 'Persisted checks, newest first' }).locator('tbody tr')).toHaveCount(storedChecks);
  const detailUrl = page.url();
  await page.reload();
  await expect(page.getByText('View saved schema')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Persisted checks, newest first' }).locator('tbody tr')).toHaveCount(storedChecks);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/dashboard-detail.png', fullPage: true });

  // Native dialog cancellation/focus and keyboard navigation in the real browser.
  await page.getByRole('button', { name: 'Replace baseline', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Replace baseline', exact: true })).toBeFocused();
  await page.getByRole('link', { name: 'All endpoints', exact: false }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/dashboard-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(detailUrl);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('View saved schema')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
  expect(browserErrors).toEqual([]);
  console.log(`Real persisted dashboard endpoint: ${detailUrl}`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});
