// Browser tests: the real frontend (served with its real security headers) against
// the real backend code behind a mock of Google's web-app redirect / CORS behaviour.
import { test, expect } from '@playwright/test';
import { startMockGas } from './mock-gas-server.mjs';
import { startStatic } from './static-server.mjs';

let mock, site, adminTemp;
const cspViolations = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  mock = await startMockGas({ execPort: 4191, echoPort: 4192 });
  site = await startStatic({ port: 4190, apiUrl: mock.apiUrl, apiOrigins: mock.origins });
  adminTemp = mock.gas.g.createAdminUser_('owner', 'Owner Name');        // as the spreadsheet menu would
});
test.afterAll(async () => { await site?.close(); await mock?.close(); });

async function open(page, path = '/') {
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspViolations.push(m.text()); });
  page.on('pageerror', (e) => cspViolations.push('pageerror: ' + e.message));
  await page.goto(site.url + path);
}
async function login(page, username, password) {
  await open(page, '/index.html');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('login page: branding, show / hide password, clear error for wrong credentials', async ({ page }) => {
  await open(page, '/');
  await expect(page.getByRole('heading', { name: 'Rukman Dataflow Management System' })).toBeVisible();
  await page.locator('#password').fill('secret-123');
  await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  await page.locator('#username').fill('owner');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#notice')).toHaveText('Invalid username or password');
  await expect(page.locator('#password')).toHaveValue('');
});

test('first sign-in with the temporary password forces a password change, then the Admin sees everything', async ({ page }) => {
  await login(page, 'owner', adminTemp);
  await expect(page).toHaveURL(/app\.html#\/account$/);
  await expect(page.getByText('You signed in with a temporary password')).toBeVisible();
  await expect(page.locator('#nav a')).toHaveCount(0);                           // nothing else until changed
  await page.locator('#cp-current').fill(adminTemp);
  await page.locator('#cp-new').fill('Strong-pass-2026');
  await page.locator('#cp-repeat').fill('Strong-pass-2026');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('#nav a')).toHaveText(['Dashboard', 'Users', 'Audit log', 'My account']);
  await expect(page.locator('.card .label')).toContainText(['Active users']);
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  // the session token is kept in sessionStorage only
  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookies: document.cookie }));
  expect(storage).toEqual({ local: [], session: ['rdms.session'], cookies: '' });
});

let staffTemp;
test('Admin creates a Staff user and a Manager; the temporary password is shown once', async ({ page }) => {
  await login(page, 'owner', 'Strong-pass-2026');
  await page.getByRole('link', { name: 'Users' }).click();
  for (const [u, role] of [['staff.one', 'Staff'], ['manager.one', 'Manager']]) {
    await page.locator('#nu-username').fill(u);
    await page.locator('#nu-name').fill(`${role} One`);
    await page.locator('#nu-role').selectOption(role);
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.locator('#temp-password')).toBeVisible();
    if (role === 'Staff') staffTemp = (await page.locator('#temp-password').textContent()).trim();
    await expect(page.locator(`tr[data-username="${u}"]`)).toContainText(role);
  }
  expect(staffTemp).toMatch(/^[A-Za-z0-9]{14}$/);
  // validation message from the server
  await page.locator('#nu-username').fill('X');
  await page.locator('#nu-name').fill('Bad');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.locator('#users-msg .alert.error')).toContainText('Username');
});

test('Staff: no Users / Audit menu, and the server refuses those screens even by direct URL', async ({ page }) => {
  await login(page, 'staff.one', staffTemp);
  await page.locator('#cp-current').fill(staffTemp);
  await page.locator('#cp-new').fill('Worker-pass-2026');
  await page.locator('#cp-repeat').fill('Worker-pass-2026');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('#nav a')).toHaveText(['Dashboard', 'My account']);
  await expect(page.locator('.card')).toHaveCount(0);                            // no user statistics for Staff
  await page.goto(site.url + '/app.html#/users');
  await expect(page.locator('.alert.error')).toHaveText('You do not have permission for this action');
  await page.goto(site.url + '/app.html#/audit');
  await expect(page.locator('.alert.error')).toHaveText('You do not have permission for this action');
});

test('a session ended on the server sends the user back to the login page', async ({ page }) => {
  await login(page, 'staff.one', 'Worker-pass-2026');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  mock.gas.g.signOutAll_();                                                      // "Sign out all users" from the sheet menu
  await page.getByRole('link', { name: 'My account' }).click();
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/index\.html\?reason=expired$/);
  await expect(page.locator('#notice')).toHaveText('Your session has ended. Please sign in again.');
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test('sign out ends the session on the server', async ({ page }) => {
  await login(page, 'manager.one', 'x'.repeat(1));                               // wrong: still has a temporary password
  await expect(page.locator('#notice')).toHaveText('Invalid username or password');
  await login(page, 'owner', 'Strong-pass-2026');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('rdms.session')).token);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/index\.html\?reason=signed-out$/);
  const r = mock.gas.post({ action: 'me', token });
  expect(r.error.code).toBe('SESSION_EXPIRED');
});

test('iPhone-size screen: login, menu opens, no horizontal page overflow (Chromium emulation, not real Safari)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  await login(page, 'owner', 'Strong-pass-2026');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(page.locator('#sidebar')).not.toBeInViewport();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#sidebar')).toBeInViewport();
  await page.getByRole('link', { name: 'Users' }).click();
  await expect(page.locator('table')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);                               // wide tables scroll inside their box
  const fontSize = await page.locator('#nu-username').evaluate((e) => getComputedStyle(e).fontSize);
  expect(fontSize).toBe('16px');                                                 // iOS does not zoom on focus
  await ctx.close();
});

test('integration facts: no CORS preflight, text/plain requests, every answer via the redirect, no CSP violations', async () => {
  expect(mock.stats.options).toBe(0);
  expect(mock.stats.posts).toBeGreaterThan(10);
  expect(mock.stats.echo).toBe(mock.stats.posts + mock.stats.gets);
  expect(new Set(mock.stats.contentTypes.map((c) => c.split(';')[0]))).toEqual(new Set(['text/plain']));
  expect(cspViolations).toEqual([]);
});
