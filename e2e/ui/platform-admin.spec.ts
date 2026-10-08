// R1 — User Management Center + Role Builder through the real UI (static
// build → local Supabase → admin-users Edge Function). Everything a business
// administrator does here needs no code change.
import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ok, service } from '../lib.mjs';

const fx = JSON.parse(readFileSync(new URL('./.fixture.json', import.meta.url), 'utf8'));
const ROLE = `STORE_${fx.runId}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
const EMAIL = `store-ui-${fx.runId}@e2e.test`;
const GA = `GA-${fx.runId}`;
const GB = `GB-${fx.runId}`;

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}
const toast = (page: Page, text: string | RegExp) => expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();

test.describe.serial('R1 user management + roles (UI)', () => {
  let owner: Page;
  let temp = '';
  let own = '';

  test.beforeAll(async ({ browser }) => {
    ok(await service.from('godowns').insert([
      { company_id: fx.companyId, code: GA, name: `Godown A ${fx.runId}` },
      { company_id: fx.companyId, code: GB, name: `Godown B ${fx.runId}` }]));
    owner = await newPage(browser);
    await login(owner, fx.owner);
    await expect(owner).toHaveURL(/\/erp\/$/);
  });

  test('owner creates a custom role in the permission matrix and duplicates it', async () => {
    await owner.getByRole('link', { name: 'Roles & permissions' }).click();
    await owner.getByRole('button', { name: 'New role' }).click();
    const dlg = owner.getByRole('dialog', { name: 'New role' });
    await dlg.getByLabel('Code').fill(ROLE);
    await dlg.getByLabel('Name').fill('Store executive UI');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await toast(owner, 'Role created');
    await expect(owner.getByRole('heading', { name: /Store executive UI/ })).toBeVisible();
    for (const code of ['items.view', 'godowns.view', 'stock_adjustment.view', 'stock_adjustment.create']) {
      await owner.getByRole('checkbox', { name: code, exact: true }).check();
    }
    await expect(owner.getByText('4 added, 0 removed')).toBeVisible();
    await owner.getByRole('button', { name: 'Save permissions' }).click();
    await toast(owner, 'Permissions saved (+4');
    await owner.getByRole('button', { name: 'Duplicate' }).click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await toast(owner, 'Role duplicated');
    await expect(owner.getByRole('checkbox', { name: 'stock_adjustment.create', exact: true })).toBeChecked();
    // the owner role is locked in the matrix
    await owner.getByRole('list', { name: 'Roles' }).getByRole('button', { name: /^Owner/ }).click();
    await expect(owner.getByRole('checkbox', { name: 'settings.edit', exact: true })).toBeDisabled();
    await expect(owner.getByRole('checkbox', { name: 'settings.edit', exact: true })).toBeChecked();
  });

  test('owner creates an internal user restricted to Godown A; temporary password shown once', async () => {
    await owner.getByRole('link', { name: 'Users', exact: true }).click();
    await owner.getByRole('button', { name: 'New user' }).click();
    const dlg = owner.getByRole('dialog', { name: 'New user' });
    await dlg.getByLabel('Email / login ID').fill(EMAIL);
    await dlg.getByLabel('Name').fill('Store Keeper UI');
    await dlg.getByLabel('Department').fill('Stores');
    await dlg.getByRole('checkbox', { name: 'Role Store executive UI', exact: true }).check();
    await dlg.getByLabel('Only selected godowns').check();
    await dlg.getByRole('checkbox', { name: `Godown ${GA}` }).check();
    await dlg.getByRole('button', { name: 'Create user' }).click();
    const pw = owner.getByTestId('temp-password');
    await expect(pw).toBeVisible();
    temp = (await pw.textContent())!.trim();
    expect(temp).toMatch(/^.{16}$/);
    await owner.getByRole('button', { name: 'Done' }).click();
    const row = owner.getByRole('row').filter({ hasText: EMAIL });
    await expect(row).toContainText('Store executive UI');
    await expect(row).toContainText(GA);
    await expect(row).toContainText('Temporary password');
  });

  test('user logs in, must change the password, then works only in Godown A', async ({ browser }) => {
    const u = await newPage(browser);
    await login(u, { email: EMAIL, password: temp });
    await expect(u.getByText('Choose your own password')).toBeVisible();
    own = `Own-${fx.runId}-Pw9`;
    await u.getByLabel('New password', { exact: true }).fill(own);
    await u.getByLabel('Repeat new password').fill(own);
    await u.getByRole('button', { name: 'Save password and continue' }).click();
    await expect(u.getByRole('link', { name: 'Godowns & locations' })).toBeVisible();
    await expect(u.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
    await expect(u.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await u.getByRole('link', { name: 'Godowns & locations' }).click();
    await expect(u.getByRole('button', { name: `Godown A ${fx.runId}` })).toBeVisible();
    await expect(u.getByText(`Godown B ${fx.runId}`)).toHaveCount(0);
    // direct URL to an admin page: refused by the shell, and the data by the database
    await u.goto('/erp/admin/users/');
    await expect(u.getByText('You do not have access to this page')).toBeVisible();
    await u.close();
  });

  test('owner sets ALLOW / DENY overrides; effective at the next load', async ({ browser }) => {
    await owner.getByRole('button', { name: 'Store Keeper UI' }).click();
    await owner.getByRole('tab', { name: 'Permissions' }).click();
    await owner.getByLabel('Find').fill('godowns.view');
    await owner.getByLabel('Override godowns.view').selectOption('DENY');
    await owner.getByLabel('Find').fill('parties.view');
    await owner.getByLabel('Override parties.view').selectOption('ALLOW');
    await owner.getByRole('button', { name: 'Save overrides' }).click();
    await toast(owner, 'Overrides saved');
    await owner.getByRole('button', { name: 'Close' }).click();
    const u = await newPage(browser);
    await login(u, { email: EMAIL, password: own });
    await expect(u.getByRole('link', { name: 'Customers & vendors' })).toBeVisible();
    await expect(u.getByRole('link', { name: 'Godowns & locations' })).toHaveCount(0);
    await u.close();
  });

  test('owner disables the user (login refused), enables, resets the password', async ({ browser }) => {
    await owner.getByRole('button', { name: 'Store Keeper UI' }).click();
    await owner.getByRole('tab', { name: 'Login & security' }).click();
    owner.once('dialog', (d) => d.accept('left the company'));
    await owner.getByRole('button', { name: 'Disable user' }).click();
    await toast(owner, 'User disabled');
    await expect(owner.getByRole('row').filter({ hasText: EMAIL })).toContainText('Disabled');
    const u = await newPage(browser);
    await login(u, { email: EMAIL, password: own });
    await expect(u.locator('[role=alert].bg-red-50')).toBeVisible();      // banned login

    await owner.getByRole('button', { name: 'Store Keeper UI' }).click();
    await owner.getByRole('tab', { name: 'Login & security' }).click();
    await owner.getByRole('button', { name: 'Enable user' }).click();
    await toast(owner, 'User enabled');
    await owner.getByRole('button', { name: 'Store Keeper UI' }).click();
    await owner.getByRole('tab', { name: 'Login & security' }).click();
    owner.once('dialog', (d) => d.accept());
    await owner.getByRole('button', { name: 'Reset password' }).click();
    const pw = owner.getByTestId('temp-password');
    await expect(pw).toBeVisible();
    const reset = (await pw.textContent())!.trim();
    await owner.getByRole('button', { name: 'Done' }).click();
    await login(u, { email: EMAIL, password: reset });
    await expect(u.getByText('Choose your own password')).toBeVisible();
    // history of the user
    await owner.getByRole('tab', { name: 'History' }).click();
    for (const a of ['PASSWORD RESET', 'ENABLE', 'DISABLE', 'OVERRIDES', 'CREATE']) {
      await expect(owner.getByRole('dialog').getByText(a, { exact: true }).first()).toBeVisible();
    }
    await owner.getByRole('button', { name: 'Close' }).click();
  });

  test('owner protection in the UI: own login cannot be disabled here', async () => {
    await owner.getByRole('row').filter({ hasText: fx.owner.email }).getByRole('button').first().click();
    await owner.getByRole('tab', { name: 'Login & security' }).click();
    await expect(owner.getByText('Use “My account” to change your own password.')).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Disable user' })).toHaveCount(0);
    await owner.getByRole('button', { name: 'Close' }).click();
  });
});
