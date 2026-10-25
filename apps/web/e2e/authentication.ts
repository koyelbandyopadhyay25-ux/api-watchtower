import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

// Test-only accounts, created deliberately through the real UI after migration approval.
const accounts = new Map<string, { email: string; password: string }>();
export async function registerBrowserUser(page: Page, role = 'A') {
  const existing = accounts.get(role);
  if (existing) { await page.goto('/'); await loginBrowserUser(page, existing); return existing; }
  const credentials = { email: `${randomUUID()}@example.test`, password: randomBytes(24).toString('base64url') };
  await page.goto('/');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByText('Registration request processed. You can now try signing in.')).toBeVisible();
  await loginBrowserUser(page, credentials);
  accounts.set(role, credentials);
  return credentials;
}
export async function loginBrowserUser(page: Page, credentials: { email: string; password: string }) {
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
