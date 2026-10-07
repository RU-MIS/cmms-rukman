// Authentication, route protection, permissions and mobile layout (runs last).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { otpCode } from '../lib.mjs';

const fx = JSON.parse(readFileSync(new URL('./.fixture.json', import.meta.url), 'utf8'));

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('anonymous user is sent to login; wrong password is refused', async ({ page }) => {
  await page.goto('/erp/inventory/');
  await expect(page).toHaveURL(/\/login\/\?next=%2Ferp%2Finventory%2F/);
  await page.getByLabel('Email').fill(fx.owner.email);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('[role=alert].bg-red-50')).toContainText(/Invalid login credentials/i);
  await page.getByLabel('Password').fill(fx.owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/erp\/inventory\/$/);              // back to the requested page
});

test('login ignores an external "next" (no open redirect)', async ({ page }) => {
  await page.goto('/login/?next=//evil.example/steal');
  await page.getByLabel('Email').fill(fx.owner.email);
  await page.getByLabel('Password').fill(fx.owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:4173\/erp\/$/);
});

test('email code (OTP) login through the UI with the real email', async ({ page }) => {
  await page.goto('/login/');
  await page.getByRole('tab', { name: 'Email code (OTP)' }).click();
  await page.getByLabel('Email').fill(fx.otpEmail);
  const t0 = Date.now() - 500;
  await page.getByRole('button', { name: 'Send login code' }).click();
  await expect(page.getByText(/A login code has been sent/)).toBeVisible();
  await page.getByLabel('Code from the email').fill(await otpCode(fx.otpEmail, { after: t0 }));
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page).toHaveURL(/\/portal\/customer\//);
  await expect(page.getByText(`Welcome, ${fx.customerName}`)).toBeVisible();
});

test('password change, logout, login with the new password', async ({ page }) => {
  await login(page, fx.operator);
  await expect(page).toHaveURL(/\/erp\/$/);
  await page.goto('/account/');
  const pw = `New-${fx.runId}-pw!`;
  await page.getByLabel('New password', { exact: true }).fill(pw);
  await page.getByLabel('Repeat new password').fill(pw);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Password changed' })).toBeVisible();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login\//);
  await page.goto('/erp/');
  await expect(page).toHaveURL(/\/login\//);                          // session really gone
  await login(page, { email: fx.operator.email, password: fx.operator.password });
  await expect(page.locator('[role=alert].bg-red-50')).toBeVisible();   // old password no longer works
  await login(page, { email: fx.operator.email, password: pw });
  await expect(page).toHaveURL(/\/erp\/$/);
  fx.operator.password = pw;
});

test('operator: no settings / users menu, settings read-only (enforced by the database)', async ({ page }) => {
  await login(page, fx.operator);
  await expect(page).toHaveURL(/\/erp\/$/);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);
  await page.goto('/erp/settings/');
  await expect(page.getByText(/only the Owner or an Admin can change them/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Allow negative stock', exact: true })).toBeDisabled();
});

test('expired / forged session returns to login instead of breaking', async ({ page }) => {
  await login(page, fx.owner);
  await expect(page).toHaveURL(/\/erp\/$/);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const v = JSON.parse(localStorage.getItem(k) ?? '{}');
        v.access_token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged';
        v.refresh_token = 'invalid';
        v.expires_at = Math.floor(Date.now() / 1000) - 60;
        localStorage.setItem(k, JSON.stringify(v));
      }
    }
  });
  await page.goto('/erp/inventory/');
  await expect(page).toHaveURL(/\/login\//, { timeout: 20_000 });
});

test('vendor cannot open the customer portal; customer cannot open the ERP', async ({ page }) => {
  await login(page, fx.vendor);
  await expect(page).toHaveURL(/\/portal\/vendor\//);
  await page.goto(`/portal/customer/?c=${fx.companyId}`);
  await expect(page.getByText('Portal access denied')).toBeVisible();
  await page.goto('/erp/settings/');
  await expect(page).toHaveURL(/\/portal\//);
});

test('mobile layout: no horizontal page overflow, menu reachable', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, fx.owner);
  await expect(page).toHaveURL(/\/erp\/$/);
  for (const path of ['/erp/', '/erp/inventory/', '/erp/sales-orders/', '/erp/purchase-orders/', '/erp/receiving/', '/erp/settings/', '/erp/email-log/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page).toHaveURL(/\/erp\/inventory\//);
  const cust = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await login(cust, fx.customer);
  await expect(cust).toHaveURL(/\/portal\/customer\//);
  await cust.waitForLoadState('networkidle');
  expect(await cust.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await ctx.close();
});
