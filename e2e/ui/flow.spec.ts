// Full business flow through the real UI (static build) against local Supabase.
import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fx = JSON.parse(readFileSync(new URL('./.fixture.json', import.meta.url), 'utf8'));
const ITEM = `BOLT-${fx.runId}`;
const ITEM_NAME = `10mm Bolt ${fx.runId}`;

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function asUser(browser: Browser, who: { email: string; password: string }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, who);
  return page;
}

const toast = (page: Page, text: string | RegExp) => expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
const noErrorToast = async (page: Page) => expect(page.locator('[role=alert].bg-red-600, [role=alert].bg-red-50')).toHaveCount(0);

test.describe.serial('inventory + portals + purchase + documents + payments', () => {
  let owner: Page;

  test.beforeAll(async ({ browser }) => {
    owner = await asUser(browser, fx.owner);
    await expect(owner).toHaveURL(/\/erp\/$/);
  });

  test('owner configures the control center', async () => {
    await owner.getByRole('link', { name: 'Settings' }).click();
    await expect(owner.getByRole('heading', { name: /Settings/ })).toBeVisible();
    const sw = (name: string) => owner.getByRole('switch', { name, exact: true });
    await expect(sw('Allow negative stock')).toHaveAttribute('aria-checked', 'false');
    for (const name of ['Customer portal', 'Vendor portal', 'Customer rate visibility', 'Email automation (master switch)']) {
      await sw(name).click();
      await expect(sw(name)).toHaveAttribute('aria-checked', 'true');
    }
    await owner.getByLabel('Customer stock visibility').selectOption('EXACT_QUANTITY');
    await owner.getByRole('button', { name: 'Save settings' }).click();
    await toast(owner, 'Settings saved');
  });

  test('godown, rack/bin location and item with packing', async () => {
    await owner.getByRole('link', { name: 'Godowns & locations' }).click();
    await owner.getByRole('button', { name: 'New godown' }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Code *').fill(`DEL-${fx.runId}`);
    await dlg.getByLabel('Name *').fill(`Delhi ${fx.runId}`);
    await dlg.getByRole('button', { name: 'Save' }).click();
    await toast(owner, 'Godown saved');
    await owner.getByRole('button', { name: `Delhi ${fx.runId}` }).click();
    await owner.getByLabel('Zone').fill('A');
    await owner.getByLabel('Rack *').fill('B1');
    await owner.getByLabel('Shelf / level').fill('C');
    await owner.getByLabel('Bin / position').fill('123');
    await owner.getByRole('button', { name: 'Add location' }).click();
    await expect(owner.getByRole('cell', { name: 'B1-C-123' })).toBeVisible();

    await owner.getByRole('link', { name: 'Items & packing' }).click();
    await owner.getByRole('button', { name: 'New item' }).click();
    const item = owner.getByRole('dialog');
    await item.getByLabel('Item code *').fill(ITEM);
    await item.getByLabel('Item name *').fill(ITEM_NAME);
    await item.getByLabel('Kind').selectOption('RAW_MATERIAL');
    await item.getByLabel(/Base unit \*/).selectOption({ label: 'PCS — Pieces' });
    await item.getByLabel('Purchase price (per base unit)').fill('100');
    await item.getByLabel('Sale price (per base unit)').fill('150');
    await item.getByLabel('Reorder level').fill('1000');
    await item.getByRole('button', { name: 'Save item' }).click();
    await toast(owner, 'Item saved');
    await item.getByRole('combobox', { name: 'Unit', exact: true }).selectOption({ label: 'BOX — Box' });
    await item.getByRole('spinbutton', { name: /Contains/ }).fill('100');
    await item.getByRole('button', { name: 'Add packing' }).click();
    await expect(item.getByText('1 BOX')).toBeVisible();
    await item.getByRole('button', { name: 'Close' }).click();
  });

  test('stock IN into a rack/bin shows in consolidated inventory and item detail', async () => {
    await owner.getByRole('link', { name: 'Stock in / out / transfer' }).click();
    await owner.getByLabel('Godown').selectOption({ label: `Delhi ${fx.runId}` });
    await owner.getByLabel('Item 1').selectOption({ label: `${ITEM} — ${ITEM_NAME}` });
    await owner.getByLabel('Qty 1').fill('200');
    await owner.getByLabel('Unit 1').selectOption({ label: 'BOX (100)' });
    await owner.getByLabel('Location 1').selectOption({ label: 'B1-C-123' });
    await owner.getByRole('button', { name: 'Post stock IN' }).click();
    await toast(owner, 'Stock posted');

    // negative stock is blocked
    await owner.getByRole('tab', { name: 'Stock OUT' }).click();
    await owner.getByLabel('Godown').selectOption({ label: `Delhi ${fx.runId}` });
    await owner.getByLabel('Item 1').selectOption({ label: `${ITEM} — ${ITEM_NAME}` });
    await owner.getByLabel('Unit 1').selectOption({ label: 'PCS' });
    await owner.getByLabel('Qty 1').fill('20001');
    await owner.getByRole('button', { name: 'Post stock OUT' }).click();
    await expect(owner.getByRole('alert').filter({ hasText: /Insufficient stock/ })).toBeVisible();

    await owner.getByRole('link', { name: 'Inventory', exact: true }).click();
    await owner.getByLabel('Search item').fill(ITEM);
    const row = owner.getByRole('row').filter({ hasText: ITEM_NAME });
    await expect(row).toContainText('20,000');
    await expect(row).toContainText('IN STOCK');
    await row.getByRole('link', { name: ITEM_NAME }).click();
    await expect(owner.getByText(`Delhi ${fx.runId} / B1-C-123`).first()).toBeVisible();
    await expect(owner.getByRole('cell', { name: 'Stock in' })).toBeVisible();
  });

  test('customer portal: catalog with stock + own price, PO with quoted price', async ({ browser }) => {
    const cust = await asUser(browser, fx.customer);
    await expect(cust).toHaveURL(/\/portal\/customer\//);
    const row = cust.getByRole('row').filter({ hasText: ITEM_NAME });
    await expect(row).toContainText('20,000');          // EXACT_QUANTITY
    await expect(row).toContainText('₹150.00');         // rate visible
    await row.getByLabel(`Qty ${ITEM}`).fill('5000');
    await row.getByRole('button', { name: 'Add to PO' }).click();
    await cust.getByRole('tab', { name: /New PO/ }).click();
    await cust.getByLabel('Your PO number *').fill(`CPO-${fx.runId}`);
    await cust.getByLabel(`Quote ${ITEM}`).fill('140');
    await cust.getByRole('button', { name: 'Submit PO' }).click();
    await toast(cust, /PO submitted/);
    await expect(cust.getByText(`PO CPO-${fx.runId}`)).toBeVisible();
    await expect(cust.getByRole('cell', { name: 'In review' })).toBeVisible();
    // the internal ERP is not reachable for a portal user
    await cust.goto('/erp/');
    await expect(cust).toHaveURL(/\/portal\//);
    await cust.context().close();
  });

  test('owner modifies price, approves, reserves and dispatches from a bin', async () => {
    await owner.getByRole('link', { name: 'Customer POs' }).click();
    await owner.getByRole('button', { name: `CPO-${fx.runId}` }).click();
    const dlg = owner.getByRole('dialog');
    await expect(dlg.getByRole('row').filter({ hasText: ITEM_NAME })).toContainText('₹140.00');
    await dlg.getByLabel(`Approved price ${ITEM}`).fill('143');
    await dlg.getByLabel('Reserve stock in godown').selectOption({ label: `Delhi ${fx.runId}` });
    await dlg.getByRole('button', { name: 'Approve → sales order' }).click();
    await toast(owner, /Approved/);

    await owner.getByRole('link', { name: 'Sales orders & dispatch' }).click();
    await owner.getByRole('row').filter({ hasText: `CPO-${fx.runId}` }).getByRole('link').click();
    const line = owner.getByRole('row').filter({ hasText: ITEM_NAME }).first();
    await expect(line).toContainText('₹140.00');
    await expect(line).toContainText('₹143.00');
    await expect(owner.getByRole('row').filter({ hasText: 'ACTIVE' })).toContainText('5,000');

    await owner.getByRole('button', { name: 'Dispatch' }).click();
    const d = owner.getByRole('dialog');
    await d.getByLabel('From godown').selectOption({ label: `Delhi ${fx.runId}` });
    await d.getByLabel(`Dispatch ${ITEM}`).fill('2000');
    await d.getByLabel(`Bin ${ITEM}`).selectOption({ label: 'B1-C-123' });
    await d.getByRole('button', { name: 'Post dispatch' }).click();
    await toast(owner, /Dispatched/);
    await expect(owner.getByText('PARTIALLY DISPATCHED').first()).toBeVisible();

    await owner.getByRole('link', { name: 'Inventory', exact: true }).click();
    await owner.getByLabel('Search item').fill(ITEM);
    const inv = owner.getByRole('row').filter({ hasText: ITEM_NAME });
    await expect(inv.locator('td').nth(1)).toContainText('18,000');   // physical
    await expect(inv.locator('td').nth(2)).toContainText('3,000');    // reserved (5000 − 2000)
    await expect(inv.locator('td').nth(3)).toContainText('15,000');   // available
  });

  test('purchase PO, partial receiving, vendor portal supply status', async ({ browser }) => {
    await owner.getByRole('link', { name: 'Purchase orders' }).click();
    await owner.getByRole('button', { name: 'New purchase order' }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Vendor *').selectOption({ label: fx.vendorName });
    await dlg.getByLabel('Item 1').selectOption({ label: `${ITEM} — ${ITEM_NAME}` });
    await dlg.getByLabel('Unit 1').selectOption({ label: 'PCS' });
    await dlg.getByLabel('Qty 1').fill('500');
    await dlg.getByLabel('Rate 1').fill('100');
    await dlg.getByRole('button', { name: 'Confirm PO' }).click();
    await toast(owner, 'PO confirmed');
    await expect(owner.getByText('OPEN', { exact: true })).toBeVisible();
    await expect(owner.getByRole('cell', { name: 'VENDOR PO' })).toBeVisible();      // PO email queued
    await owner.getByRole('button', { name: 'Receive' }).click();
    await owner.getByLabel('Godown').selectOption({ label: `Delhi ${fx.runId}` });
    await owner.getByLabel(`Receive ${ITEM}`).fill('140');
    await owner.getByLabel(`Bin ${ITEM}`).selectOption({ label: 'B1-C-123' });
    await owner.getByRole('button', { name: 'Post receipt' }).click();
    await toast(owner, /Received/);
    await expect(owner.getByRole('row').filter({ hasText: ITEM_NAME }).first()).toContainText('360');
    await owner.getByLabel(`Receive ${ITEM}`).fill('361');
    await owner.getByRole('button', { name: 'Post receipt' }).click();
    await expect(owner.getByRole('alert').filter({ hasText: /Over-receiving rejected/ })).toBeVisible();

    const vend = await asUser(browser, fx.vendor);
    await expect(vend).toHaveURL(/\/portal\/vendor\//);
    const vrow = vend.getByRole('row').filter({ hasText: ITEM_NAME });
    await expect(vrow.locator('td').nth(2)).toContainText('140');
    await expect(vrow.locator('td').nth(3)).toContainText('360');
    await expect(vend.getByRole('columnheader', { name: 'Rate' })).toHaveCount(0);   // vendor rate hidden by default
    const download = vend.waitForEvent('download');
    await vend.getByRole('button', { name: 'PO PDF' }).click();
    expect((await download).suggestedFilename()).toMatch(/^PO-.*\.pdf$/);
    await vend.context().close();
  });

  test('Tally invoice upload queues the customer email; payments settle it partly', async ({ browser }) => {
    await owner.getByRole('link', { name: 'Invoices & bills' }).click();
    await owner.getByRole('button', { name: 'Record Tally invoice' }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Customer *').selectOption({ label: fx.customerName });
    await dlg.getByLabel('Invoice no (as in Tally) *').fill(`T/${fx.runId}`);
    await dlg.getByLabel('Amount (incl. GST) *').fill('100000');
    await dlg.getByLabel('Invoice PDF').setInputFiles({ name: 'tally-invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 tally') });
    await dlg.getByRole('button', { name: 'Save invoice' }).click();
    await toast(owner, /Invoice recorded/);
    await noErrorToast(owner);

    await owner.getByRole('link', { name: 'Email log' }).click();
    await expect(owner.getByRole('row').filter({ hasText: `Invoice T/${fx.runId}` })).toContainText('QUEUED');

    await owner.getByRole('link', { name: 'Payments', exact: true }).click();
    await owner.getByRole('button', { name: 'Receive from customer' }).click();
    const p = owner.getByRole('dialog');
    await p.getByLabel('Customer').selectOption({ label: fx.customerName });
    await p.getByLabel('Received into').selectOption({ label: 'Cash (cash)' });
    await p.getByLabel('Method').selectOption('CASH');
    await p.getByLabel('Amount').fill('40000');
    await p.getByRole('button', { name: 'Allocate oldest first' }).click();
    await p.getByRole('button', { name: 'Post' }).click();
    await toast(owner, 'Payment posted');

    await owner.getByRole('link', { name: 'Invoices & bills' }).click();
    await expect(owner.getByRole('row').filter({ hasText: `T/${fx.runId}` })).toContainText('₹60,000.00');

    const cust = await asUser(browser, fx.customer);
    await cust.getByRole('tab', { name: 'Invoices' }).click();
    const inv = cust.getByRole('row').filter({ hasText: `T/${fx.runId}` });
    await expect(inv).toContainText('₹60,000.00');
    await expect(inv.getByRole('button', { name: 'tally-invoice.pdf' })).toBeVisible();
    await cust.getByRole('tab', { name: 'Payments' }).click();
    await expect(cust.getByRole('row').filter({ hasText: '₹40,000.00' })).toBeVisible();
    await cust.context().close();
  });
});
