// R2 — item master, customers / vendors, Import / Export Center, data scopes,
// field visibility and portal permissions through the real UI (static build →
// local Supabase). Files are real .xlsx workbooks.
import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import writeXlsxFile from 'write-excel-file/node';
import readXlsxFile from 'read-excel-file/node';
import { ok, party, portalUser, role, service, staff } from '../lib.mjs';

const fx = JSON.parse(readFileSync(new URL('./.fixture.json', import.meta.url), 'utf8'));
const R = fx.runId as string;
const ITEM = `R2-${R}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const newPage = async (browser: Browser) => (await browser.newContext({ acceptDownloads: true })).newPage();
const toast = (page: Page, text: string | RegExp) => expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();

/** An .xlsx file with a "Data" sheet: header row + rows. */
async function xlsx(header: string[], rows: (string | number | null)[][]) {
  const data = [header.map((h) => ({ value: h })), ...rows.map((r) => r.map((v) => (v === null ? null : { value: v })))];
  return (await writeXlsxFile([{ sheet: 'Data', data: data as never }]).toBuffer()) as Buffer;
}

test.describe.serial('R2 master data + import / export (UI)', () => {
  test.setTimeout(180_000);
  let owner: Page;
  let ownerCtxCompany: string;

  test.beforeAll(async ({ browser }) => {
    owner = await newPage(browser);
    await login(owner, fx.owner);
    await expect(owner).toHaveURL(/\/erp\/$/);
    ownerCtxCompany = fx.companyId;
  });

  test('item master: create, edit, rates with history, image upload / replace / delete', async () => {
    await owner.getByRole('link', { name: 'Admin control center' }).click();
    await owner.locator('main a[href="/erp/admin/items/"]').click();
    await expect(owner).toHaveURL(/\/erp\/admin\/items\/$/);
    await owner.getByRole('button', { name: 'New item' }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Item code', { exact: true }).fill(ITEM);
    await dlg.getByLabel('Item name *').fill(`R2 item ${R}`);
    await dlg.getByLabel('Base unit * (stock is kept in this unit)').selectOption({ label: 'PCS — Pieces' });
    await dlg.getByLabel('SKU').fill(`SKU-${R}`);
    await dlg.getByLabel('Sale price (per base unit)').fill('25');
    await dlg.getByLabel('Reorder level').fill('40');
    await dlg.getByRole('button', { name: 'Save item' }).click();
    await toast(owner, 'Item saved');
    // edit the price → rate history
    await dlg.getByLabel('Sale price (per base unit)').fill('27.5');
    await dlg.getByRole('button', { name: 'Save item' }).click();
    await toast(owner, 'Item saved');
    await dlg.getByRole('tab', { name: 'Rates' }).click();
    await dlg.getByRole('combobox', { name: 'Customer', exact: true }).selectOption({ label: `CUST-${R} — ${fx.customerName}` });
    await dlg.getByRole('spinbutton', { name: 'Rate', exact: true }).fill('24');
    await dlg.getByRole('button', { name: 'Add rate' }).click();
    await toast(owner, 'Rate saved');
    await expect(dlg.getByRole('row').filter({ hasText: `CUST-${R}` }).first()).toContainText('24.00');
    const history = dlg.locator('section, div').filter({ has: owner.getByText('Rate history') }).last();
    await expect(history.getByRole('row').filter({ hasText: 'Item master · change' })).toContainText('27.50');
    await expect(history.getByRole('row').filter({ hasText: 'Rate list · set' })).toBeVisible();

    await dlg.getByRole('tab', { name: 'Images' }).click();
    await dlg.getByLabel('Image file').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG });
    await toast(owner, 'Image uploaded');
    await expect(dlg.getByRole('img', { name: 'front.png' })).toBeVisible();
    // the image is served through a short-lived signed URL of the private bucket
    expect(await dlg.getByRole('img', { name: 'front.png' }).getAttribute('src')).toMatch(/\/object\/sign\/item-images\/.*token=/);
    await dlg.getByRole('img', { name: 'front.png' }).click();
    await expect(owner.getByRole('dialog', { name: 'Image' })).toBeVisible();
    await owner.getByRole('dialog', { name: 'Image' }).getByRole('button', { name: /close/i }).click();
    const chooser = owner.waitForEvent('filechooser');
    await dlg.getByRole('button', { name: 'Replace' }).click();
    await (await chooser).setFiles({ name: 'back.png', mimeType: 'image/png', buffer: PNG });
    await toast(owner, 'Image replaced');
    await expect(dlg.getByRole('img', { name: 'back.png' })).toBeVisible();
    await expect(dlg.getByRole('img', { name: 'front.png' })).toHaveCount(0);
    owner.once('dialog', (d) => d.accept());
    await dlg.getByRole('button', { name: 'Delete' }).click();
    await toast(owner, 'Image deleted');
    await expect(dlg.getByText('No images')).toBeVisible();
    await owner.keyboard.press('Escape');
  });

  test('customer and vendor: create, address, portal login with a portal role', async () => {
    await owner.goto('/erp/admin/customers/');
    await owner.getByRole('button', { name: 'New customer' }).click();
    let dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Code (empty = next automatic code)').fill(`C2-${R}`);
    await dlg.getByLabel('Name *').fill(`Customer Two ${R}`);
    await dlg.getByLabel('Credit limit').fill('250000');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await toast(owner, 'Saved');
    await dlg.getByRole('tab', { name: 'Addresses' }).click();
    await dlg.getByLabel('Address code').fill('SHIP1');
    await dlg.getByRole('textbox', { name: 'Name', exact: true }).fill('Main warehouse');
    await dlg.getByLabel('City').fill('Jaipur');
    await dlg.getByRole('button', { name: 'Add address' }).click();
    await toast(owner, 'Address added');
    await dlg.getByRole('tab', { name: 'Customer users' }).click();
    await dlg.getByLabel('Login email').fill(`c2-${R}@e2e.test`);
    await dlg.getByRole('textbox', { name: 'Name', exact: true }).fill('Buyer Two');
    await dlg.getByRole('button', { name: 'Create login' }).click();
    await expect(owner.getByTestId('temp-password')).toBeVisible();
    await owner.getByRole('button', { name: 'Done' }).click();
    await expect(dlg.getByLabel(`Portal role of c2-${R}@e2e.test`)).toBeVisible();
    await dlg.getByLabel(`Portal role of c2-${R}@e2e.test`).selectOption({ label: 'Customer user' });
    await toast(owner, 'Portal role saved');
    await owner.keyboard.press('Escape');
    await expect(owner.getByRole('button', { name: `Customer Two ${R}` })).toBeVisible();

    await owner.goto('/erp/admin/vendors/');
    await owner.getByRole('button', { name: 'New vendor' }).click();
    dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Code (empty = next automatic code)').fill(`V2-${R}`);
    await dlg.getByLabel('Name *').fill(`Vendor Two ${R}`);
    await dlg.getByRole('group', { name: 'Vendor type' }).getByLabel(/job worker/i).check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await toast(owner, 'Saved');
    await owner.keyboard.press('Escape');
    await expect(owner.getByRole('row').filter({ hasText: `V2-${R}` })).toContainText(/JOB WORKER/i);
  });

  test('import wizard: template, invalid file all-or-nothing, error report, valid rows only', async () => {
    await owner.goto('/erp/admin/import-export/?entity=ITEMS');
    await expect(owner.getByRole('heading', { name: 'Items', exact: true })).toBeVisible();
    // template = real xlsx with Data + Instructions sheets
    const tpl = owner.waitForEvent('download');
    await owner.getByRole('button', { name: 'Download template' }).click();
    const tplPath = await (await tpl).path();
    const sheets = await readXlsxFile(tplPath!);
    expect(sheets.map((s: { sheet: string }) => s.sheet)).toEqual(['Data', 'Instructions']);
    expect(sheets[0].data[0]).toEqual(expect.arrayContaining(['code *', 'name *', 'item_kind *', 'base_unit *', 'description']));
    expect(JSON.stringify(sheets[1].data)).toContain('FINISHED_GOOD, RAW_MATERIAL, PACKING, SERVICE');

    const file = await xlsx(['code *', 'name *', 'item_kind *', 'base_unit *', 'sale_price'], [
      [`IMPX-1-${R}`, 'Imported one', 'RAW_MATERIAL', 'PCS', 5],
      [`IMPX-2-${R}`, 'Imported two', 'WOOD', 'PCS', null],
      [`impx-1-${R}`, 'Duplicate', 'PACKING', 'PCS', null],
      [ITEM, 'Exists already', 'PACKING', 'PCS', null]]);
    await owner.getByLabel('Import file').setInputFiles({ name: 'items.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: file });
    await owner.getByRole('button', { name: 'Validate file' }).click();
    await toast(owner, 'Validation finished');
    const errs = owner.getByRole('table').filter({ hasText: 'Reason' });
    await expect(errs.getByRole('row').filter({ hasText: 'WOOD' })).toContainText('3');
    await expect(errs.getByRole('row').filter({ hasText: 'Duplicate of row 2' })).toContainText('4');
    await expect(errs.getByRole('row').filter({ hasText: 'already exists' })).toContainText('5');
    await expect(owner.getByText(/All-or-nothing: fix the 3 invalid row/)).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Import now' })).toHaveCount(0);
    const rep = owner.waitForEvent('download');
    await owner.getByRole('button', { name: 'Download error report' }).click();
    const report = await readXlsxFile((await (await rep).path())!);
    expect(JSON.stringify(report[0].data)).toContain('item_kind: Allowed');
    // nothing was written
    expect(ok(await service.from('items').select('id').eq('company_id', fx.companyId).ilike('code', `IMPX-%-${R}`))).toHaveLength(0);

    // valid rows only: explicit choice + explicit confirmation
    await owner.getByLabel('Import valid rows only').check();
    await owner.getByRole('button', { name: 'Validate file' }).click();
    await toast(owner, 'Validation finished');
    await expect(owner.getByRole('button', { name: 'Import now' })).toBeDisabled();
    await owner.getByLabel('Confirm import').check();
    await owner.getByRole('button', { name: 'Import now' }).click();
    await expect(owner.getByText('Imported 1 row(s).')).toBeVisible();
    const rows = ok(await service.from('items').select('code').eq('company_id', fx.companyId).ilike('code', `IMPX-%-${R}`));
    expect(rows.map((r: { code: string }) => r.code)).toEqual([`IMPX-1-${R}`.toUpperCase()]);  // codes are normalised to upper case
    expect(ok(await service.from('items').select('name').eq('company_id', fx.companyId).eq('code', ITEM))[0].name).toBe(`R2 item ${R}`);
  });

  test('all-or-nothing with a write failure rolls back everything (UI)', async () => {
    await owner.goto('/erp/admin/import-export/?entity=ITEMS');
    const file = await xlsx(['code *', 'name *', 'item_kind *', 'base_unit *', 'barcode'], [
      [`RB-1-${R}`, 'Rollback one', 'PACKING', 'PCS', `BC${R}`],
      [`RB-2-${R}`, 'Rollback two', 'PACKING', 'PCS', `BC${R}`]]);
    await owner.getByLabel('Import file').setInputFiles({ name: 'rb.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: file });
    await owner.getByRole('button', { name: 'Validate file' }).click();
    await toast(owner, 'Validation finished');
    await owner.getByLabel('Confirm import').check();
    await owner.getByRole('button', { name: 'Import now' }).click();
    await expect(owner.getByRole('status').filter({ hasText: /rolled back|Nothing was imported|nothing/i }).first()).toBeVisible();
    expect(ok(await service.from('items').select('id').eq('company_id', fx.companyId).ilike('code', `RB-%-${R}`))).toHaveLength(0);
  });

  test('export: Excel download contains the visible records', async () => {
    await owner.goto('/erp/admin/import-export/?entity=ITEMS');
    const dl = owner.waitForEvent('download');
    await owner.getByRole('button', { name: 'Export Excel' }).click();
    const sheet = (await readXlsxFile((await (await dl).path())!))[0].data as unknown[][];
    expect(sheet[0]).toEqual(expect.arrayContaining(['code', 'name', 'sale_price']));
    const row = sheet.find((r) => r[0] === ITEM)!;
    expect(row).toBeTruthy();
    expect(row[sheet[0].indexOf('sale_price')]).toBe(27.5);
  });

  test('limited user: item scope, hidden rates, no import / export, direct URLs refused', async ({ browser }) => {
    const mine = ok(await service.from('items').select('id').eq('company_id', ownerCtxCompany).eq('code', ITEM).single()).id;
    // the owner's API session (same rules as the UI) creates the role and the scope
    const { createClient } = await import('@supabase/supabase-js');
    const oc = createClient(process.env.E2E_API_URL!, process.env.E2E_ANON_KEY!, { auth: { persistSession: false } });
    ok(await oc.auth.signInWithPassword(fx.owner));
    const limited = await staff(oc, fx.companyId, 'r2-limited', await role(oc, fx.companyId, 'r2lim', ['items.view', 'items.edit']), { ITEM: [mine] });
    const u = await newPage(browser);
    await login(u, limited);
    await expect(u).toHaveURL(/\/erp\/$/);
    await u.goto('/erp/admin/items/');
    await expect(u.getByRole('row').filter({ hasText: ITEM })).toBeVisible();
    await expect(u.getByText(`IMPX-1-${R}`.toUpperCase())).toHaveCount(0);
    await expect(u.getByRole('button', { name: 'Export' })).toHaveCount(0);
    await u.getByRole('row').filter({ hasText: ITEM }).getByRole('button', { name: 'Edit' }).click();
    await expect(u.getByRole('dialog').getByLabel('Item name *')).toBeVisible();
    await expect(u.getByRole('dialog').getByLabel('Sale price (per base unit)')).toHaveCount(0);
    await expect(u.getByRole('dialog').getByText('27.5')).toHaveCount(0);
    await u.keyboard.press('Escape');
    // direct URLs
    await u.goto('/erp/admin/import-export/');
    await expect(u.getByText('You do not have access to this page.')).toBeVisible();
    await u.goto('/erp/admin/customers/');
    await expect(u.getByText('You do not have access to this page.')).toBeVisible();
    await u.goto('/erp/admin/users/');
    await expect(u.getByText('You do not have access to this page.')).toBeVisible();
  });

  test('roles: scope editor with "No access", portal role tabs', async () => {
    await owner.goto('/erp/admin/roles/');
    await owner.getByRole('tab', { name: 'Customer portal roles' }).click();
    await expect(owner.getByRole('list', { name: 'Roles' }).getByRole('button', { name: /Customer admin/ })).toBeVisible();
    await owner.getByRole('list', { name: 'Roles' }).getByRole('button', { name: /Customer user/ }).click();
    await expect(owner.getByRole('checkbox', { name: 'portal_customer.catalog', exact: true })).toBeVisible();
    await expect(owner.getByRole('checkbox', { name: 'items.view', exact: true })).toHaveCount(0);
    await owner.getByRole('tab', { name: 'Staff roles' }).click();
    await owner.getByRole('list', { name: 'Roles' }).getByRole('button', { name: /^Sales/ }).first().click();
    await owner.getByRole('tab', { name: 'Data access' }).click();
    const vend = owner.getByRole('group', { name: 'Vendor access' });
    await vend.getByLabel('No access').check();
    await owner.getByRole('button', { name: 'Save data access' }).click();
    await toast(owner, 'Data access saved');
    await vend.getByLabel('All vendors').check();
    await owner.getByRole('button', { name: 'Save data access' }).click();
    await toast(owner, 'Data access saved');
  });

  test('portal: features follow the portal role (Customer A catalogue, Customer B invoices only)', async ({ browser }) => {
    const { createClient } = await import('@supabase/supabase-js');
    const oc = createClient(process.env.E2E_API_URL!, process.env.E2E_ANON_KEY!, { auth: { persistSession: false } });
    ok(await oc.auth.signInWithPassword(fx.owner));
    ok(await service.from('company_settings').update({ customer_portal_enabled: true }).eq('company_id', fx.companyId));
    const custB = await party(oc, fx.companyId, 'PORTB', 'CUSTOMER');
    const b = await portalUser(oc, custB, 'CUSTOMER', 'r2-portal-b');
    const roleB = await role(oc, fx.companyId, 'invonly', ['portal_customer.view_invoices', 'portal_customer.view_payments'], 'CUSTOMER_PORTAL');
    const pu = ok(await oc.from('portal_users').select('id').eq('party_id', custB).single()).id;
    ok(await oc.rpc('portal_user_set_role', { p_portal_user_id: pu, p_role_id: roleB }));

    const p = await newPage(browser);
    await login(p, b);
    await expect(p.getByRole('tab', { name: 'Invoices' })).toBeVisible();
    await expect(p.getByRole('tab', { name: 'Payments' })).toBeVisible();
    await expect(p.getByRole('tab', { name: 'Products' })).toHaveCount(0);
    await expect(p.getByRole('tab', { name: /New PO/ })).toHaveCount(0);

    // fixture customer (default Customer admin role) still has the catalogue
    const a = await newPage(browser);
    await login(a, fx.customer);
    await expect(a.getByRole('tab', { name: 'Products' })).toBeVisible();
  });
});
