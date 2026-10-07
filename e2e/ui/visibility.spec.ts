// Settings take effect immediately in the customer portal; individual override
// from the party screen beats the company setting (runs after flow.spec.ts).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fx = JSON.parse(readFileSync(new URL('./.fixture.json', import.meta.url), 'utf8'));
const ITEM_NAME = `10mm Bolt ${fx.runId}`;

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('company setting HIDDEN / rate OFF, then customer override EXACT', async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await login(owner, fx.owner);
  await expect(owner).toHaveURL(/\/erp\/$/);
  await owner.goto('/erp/settings/');
  await owner.getByLabel('Customer stock visibility').selectOption('HIDDEN');
  await owner.getByRole('switch', { name: 'Customer rate visibility', exact: true }).click();
  await owner.getByRole('button', { name: 'Save settings' }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible();

  const cust = await (await browser.newContext()).newPage();
  await login(cust, fx.customer);
  await expect(cust.getByRole('row').filter({ hasText: ITEM_NAME })).toBeVisible();
  await expect(cust.getByRole('columnheader', { name: 'Stock' })).toHaveCount(0);
  await expect(cust.getByRole('columnheader', { name: 'Price' })).toHaveCount(0);
  await expect(cust.getByText('₹150.00')).toHaveCount(0);

  // individual override for this customer
  await owner.goto('/erp/parties/');
  await owner.getByRole('button', { name: fx.customerName }).click();
  await owner.getByRole('dialog').getByRole('tab', { name: 'Visibility & email' }).click();
  await owner.getByRole('dialog').getByLabel('Stock visibility').selectOption('EXACT_QUANTITY');
  await owner.getByRole('dialog').getByRole('button', { name: 'Save overrides' }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'Overrides saved' })).toBeVisible();

  await cust.reload();
  const row = cust.getByRole('row').filter({ hasText: ITEM_NAME });
  await expect(cust.getByRole('columnheader', { name: 'Stock' })).toBeVisible();
  await expect(row).toContainText(/\d{1,3}(,\d{2,3})+ PCS/);
  await expect(cust.getByRole('columnheader', { name: 'Price' })).toHaveCount(0);   // rate still hidden
});
