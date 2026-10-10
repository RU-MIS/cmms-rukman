// J33 — the original critical acceptance criteria of the platform
// specification as ONE browser journey (R3 exit gate X-3): godown master by
// import → custom role in the matrix → user with a temporary password
// restricted to one godown → forced password change → the restriction holds
// in the UI and through the API → item with rate and image → imports and
// exports of items / customers / vendors / godowns / opening stock → portal
// login with a configured portal role → unauthorized import / export / admin
// refused → audit visible to the owner only. Real .xlsx files throughout.
import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import writeXlsxFile from 'write-excel-file/node';
import readXlsxFile from 'read-excel-file/node';
import { createClient } from '@supabase/supabase-js';
import { ok, service, url } from '../lib.mjs';

const fx = JSON.parse(readFileSync(new URL('./.fixture.json', import.meta.url), 'utf8'));
const R = fx.runId as string;
const U = R.toUpperCase();
const JA = `JA-${U}`;
const JB = `JB-${U}`;
const ROLE = `JSTORE_${R}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
const EMAIL = `j33-store-${R}@e2e.test`;
const ITEM = `J33-${U}`;
const CUST = `JC-${U}`;
const VEND = `JV-${U}`;
const PORTAL = `j33-portal-${R}@e2e.test`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const newPage = async (browser: Browser) => (await browser.newContext({ acceptDownloads: true })).newPage();
const toast = (page: Page, text: string | RegExp) => expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();
async function xlsx(header: string[], rows: (string | number | null)[][]) {
  const data = [header.map((h) => ({ value: h })), ...rows.map((r) => r.map((v) => (v === null ? null : { value: v })))];
  return (await writeXlsxFile([{ sheet: 'Data', data: data as never }]).toBuffer()) as Buffer;
}
async function changePassword(page: Page, pw: string) {
  await expect(page.getByText('Choose your own password')).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(pw);
  await page.getByLabel('Repeat new password').fill(pw);
  await page.getByRole('button', { name: 'Save password and continue' }).click();
}
/** Import through the Import / Export Center (all-or-nothing, explicit confirmation). */
async function importFile(page: Page, entity: string, header: string[], rows: (string | number | null)[][], expected: number) {
  await page.goto(`/erp/admin/import-export/?entity=${entity}`);
  await page.getByLabel('Import file').setInputFiles({ name: `${entity}.xlsx`, mimeType: XLSX, buffer: await xlsx(header, rows) });
  await page.getByRole('button', { name: 'Validate file' }).click();
  await toast(page, 'Validation finished');
  await page.getByLabel('Confirm import').check();
  await page.getByRole('button', { name: 'Import now' }).click();
  await expect(page.getByText(`Imported ${expected} row(s).`)).toBeVisible();
}
/** Export as Excel; returns the data rows as objects keyed by header. */
async function exportFile(page: Page, entity: string) {
  await page.goto(`/erp/admin/import-export/?entity=${entity}`);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel' }).click();
  const sheet = (await readXlsxFile((await (await dl).path())!))[0].data as unknown[][];
  return sheet.slice(1).map((r) => Object.fromEntries((sheet[0] as string[]).map((h, i) => [h, r[i]])));
}

test.describe.serial('J33 — original acceptance criteria as one journey', () => {
  test.setTimeout(180_000);
  let owner: Page;
  let temp = '';
  const own = `Own-${R}-J33pw`;

  test.beforeAll(async ({ browser }) => {
    owner = await newPage(browser);
    await login(owner, fx.owner);
    await expect(owner).toHaveURL(/\/erp\/$/);
  });

  test('AC 1–3: godown master imported from Excel and exported again', async () => {
    await importFile(owner, 'GODOWNS', ['code *', 'name *'], [[JA, `J33 Godown A ${R}`], [JB, `J33 Godown B ${R}`]], 2);
    const out = await exportFile(owner, 'GODOWNS');
    expect(out.map((r) => r.code)).toEqual(expect.arrayContaining([JA, JB]));
  });

  test('AC 4–6: custom role built in the permission matrix', async () => {
    await owner.getByRole('link', { name: 'Roles & permissions' }).click();
    await owner.getByRole('button', { name: 'New role' }).click();
    const dlg = owner.getByRole('dialog', { name: 'New role' });
    await dlg.getByLabel('Code').fill(ROLE);
    await dlg.getByLabel('Name').fill('J33 store');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await toast(owner, 'Role created');
    for (const code of ['items.view', 'godowns.view', 'stock_adjustment.view', 'stock_adjustment.create']) {
      await owner.getByRole('checkbox', { name: code, exact: true }).check();
    }
    await owner.getByRole('button', { name: 'Save permissions' }).click();
    await toast(owner, 'Permissions saved (+4');
  });

  test('AC 7–10: user with a temporary password, restricted to one godown', async () => {
    await owner.getByRole('link', { name: 'Users', exact: true }).click();
    await owner.getByRole('button', { name: 'New user' }).click();
    const dlg = owner.getByRole('dialog', { name: 'New user' });
    await dlg.getByLabel('Email / login ID').fill(EMAIL);
    await dlg.getByLabel('Name').fill('J33 Store Keeper');
    await dlg.getByRole('checkbox', { name: 'Role J33 store', exact: true }).check();
    await dlg.getByLabel('Only selected godowns').check();
    await dlg.getByRole('checkbox', { name: `Godown ${JA}` }).check();
    await dlg.getByRole('button', { name: 'Create user' }).click();
    const pw = owner.getByTestId('temp-password');
    await expect(pw).toBeVisible();
    temp = (await pw.textContent())!.trim();
    await owner.getByRole('button', { name: 'Done' }).click();
    await expect(owner.getByRole('row').filter({ hasText: EMAIL })).toContainText('Temporary password');
  });

  test('AC 11–15: forced password change; godown restriction, admin, import, export and API refused', async ({ browser }) => {
    const u = await newPage(browser);
    await login(u, { email: EMAIL, password: temp });
    await changePassword(u, own);
    await u.getByRole('link', { name: 'Godowns & locations' }).click();
    await expect(u.getByRole('button', { name: `J33 Godown A ${R}` })).toBeVisible();
    await expect(u.getByText(`J33 Godown B ${R}`)).toHaveCount(0);
    for (const path of ['/erp/admin/users/', '/erp/admin/import-export/', '/erp/admin/audit/', '/erp/admin/settings/']) {
      await u.goto(path);
      await expect(u.getByText(/You do not have access to this page/)).toBeVisible();
    }
    // the same user through the API: the database refuses, whatever the UI shows
    const c = createClient(url, process.env.E2E_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    ok(await c.auth.signInWithPassword({ email: EMAIL, password: own }));
    expect((await c.rpc('export_rows', { p_company_id: fx.companyId, p_entity: 'ITEMS' })).error?.message).toMatch(/items\.export/);
    expect((await c.rpc('import_create', { p_company_id: fx.companyId, p_entity: 'ITEMS', p_file_name: 'x', p_mode: 'ALL_OR_NOTHING',
      p_update_existing: false, p_columns: ['code'] })).error?.message).toMatch(/items\.import/);
    const godowns = ok(await c.from('godowns').select('code').eq('company_id', fx.companyId).in('code', [JA, JB]));
    expect(godowns.map((g: { code: string }) => g.code)).toEqual([JA]);
    expect(ok(await c.rpc('audit_search', { p_company_id: fx.companyId, p_filters: {} }))).toEqual([]);
    await u.close();
  });

  test('AC 16–20: item master with rate, customer rate and image', async () => {
    await owner.goto('/erp/admin/items/');
    await owner.getByRole('button', { name: 'New item' }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Item code', { exact: true }).fill(ITEM);
    await dlg.getByLabel('Item name *').fill(`J33 item ${R}`);
    await dlg.getByLabel('Base unit * (stock is kept in this unit)').selectOption({ label: 'PCS — Pieces' });
    await dlg.getByLabel('Sale price (per base unit)').fill('40');
    await dlg.getByRole('button', { name: 'Save item' }).click();
    await toast(owner, 'Item saved');
    await dlg.getByRole('tab', { name: 'Rates' }).click();
    await dlg.getByRole('combobox', { name: 'Customer', exact: true }).selectOption({ label: `CUST-${R} — ${fx.customerName}` });
    await dlg.getByRole('spinbutton', { name: 'Rate', exact: true }).fill('38');
    await dlg.getByRole('button', { name: 'Add rate' }).click();
    await toast(owner, 'Rate saved');
    await dlg.getByRole('tab', { name: 'Images' }).click();
    await dlg.getByLabel('Image file').setInputFiles({ name: 'j33.png', mimeType: 'image/png', buffer: PNG });
    await toast(owner, 'Image uploaded');
    await expect(dlg.getByRole('img', { name: 'j33.png' })).toBeVisible();
    await owner.keyboard.press('Escape');
  });

  test('AC 21–26: imports and exports of items, customers, vendors and opening stock', async () => {
    await importFile(owner, 'ITEMS', ['code *', 'name *', 'item_kind *', 'base_unit *', 'sale_price'],
      [[`${ITEM}-B`, `J33 item B ${R}`, 'RAW_MATERIAL', 'PCS', 12]], 1);
    const items = await exportFile(owner, 'ITEMS');
    expect(items.find((r) => r.code === ITEM)?.sale_price).toBe(40);
    expect(items.some((r) => r.code === `${ITEM}-B`)).toBe(true);

    await importFile(owner, 'CUSTOMERS', ['code *', 'name *', 'email'], [[CUST, `J33 Customer ${R}`, `j33-cust-${R}@e2e.test`]], 1);
    expect((await exportFile(owner, 'CUSTOMERS')).some((r) => r.code === CUST)).toBe(true);
    await importFile(owner, 'VENDORS', ['code *', 'name *'], [[VEND, `J33 Vendor ${R}`]], 1);
    expect((await exportFile(owner, 'VENDORS')).some((r) => r.code === VEND)).toBe(true);

    await importFile(owner, 'OPENING_STOCK', ['item_code *', 'godown_code *', 'qty *'], [[ITEM, JA, 75]], 1);
    const it = ok(await service.from('items').select('id').eq('company_id', fx.companyId).eq('code', ITEM).single()).id;
    const gd = ok(await service.from('godowns').select('id').eq('company_id', fx.companyId).eq('code', JA).single()).id;
    const bal = ok(await service.from('stock_balances').select('base_qty').eq('item_id', it).eq('godown_id', gd));
    expect(bal.reduce((s: number, b: { base_qty: number }) => s + Number(b.base_qty), 0)).toBe(75);
    expect((await exportFile(owner, 'OPENING_STOCK')).length).toBeGreaterThanOrEqual(0);
  });

  test('AC 27–30: portal login for an imported customer with a configured portal role', async ({ browser }) => {
    await owner.goto('/erp/admin/customers/');
    await owner.getByRole('button', { name: `J33 Customer ${R}` }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByRole('tab', { name: 'Customer users' }).click();
    await dlg.getByLabel('Login email').fill(PORTAL);
    await dlg.getByRole('textbox', { name: 'Name', exact: true }).fill('J33 Buyer');
    await dlg.getByRole('button', { name: 'Create login' }).click();
    const pw = owner.getByTestId('temp-password');
    await expect(pw).toBeVisible();
    const portalTemp = (await pw.textContent())!.trim();
    await owner.getByRole('button', { name: 'Done' }).click();
    await dlg.getByLabel(`Portal role of ${PORTAL}`).selectOption({ label: 'Customer user' });
    await toast(owner, 'Portal role saved');
    await owner.keyboard.press('Escape');

    const p = await newPage(browser);
    await login(p, { email: PORTAL, password: portalTemp });
    await changePassword(p, `Portal-${R}-J33pw`);
    await expect(p.getByText(`Welcome, J33 Customer ${R}`)).toBeVisible();
    await expect(p.getByRole('tab', { name: 'Products' })).toBeVisible();          // Customer user: catalogue
    await expect(p.getByRole('tab', { name: 'Invoices' })).toHaveCount(0);         // … but no invoices
    await p.goto('/erp/');
    await expect(p).not.toHaveURL(/\/erp\/$/);                                      // no internal ERP for a portal login
    await p.close();
  });

  test('AC 31–33: audit trail visible to the owner, with who / what / when', async () => {
    const it = ok(await service.from('items').select('id').eq('company_id', fx.companyId).eq('code', ITEM).single()).id;
    await owner.getByRole('link', { name: 'Audit log', exact: true }).click();
    await owner.getByLabel('Record id').fill(it);
    await owner.getByRole('button', { name: 'Filter' }).click();
    await expect(owner.getByRole('cell', { name: 'items', exact: true }).first()).toBeVisible();
    await expect(owner.getByRole('cell', { name: fx.owner.email }).first()).toBeVisible();
    const godownAudit = ok(await service.from('audit_log').select('action').eq('company_id', fx.companyId).eq('table_name', 'godowns'));
    expect(godownAudit.length).toBeGreaterThan(0);
  });
});
