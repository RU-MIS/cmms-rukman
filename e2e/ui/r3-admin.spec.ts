// R3 — company administration through the real UI (static build → local
// Supabase): modules, branding, departments, numbering, approval rules and the
// approvals inbox, audit log, and what an ordinary user can not reach.
// Every change is reverted at the end so the later suites see the defaults.
import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { ok, role, service, staff, unitId, url } from '../lib.mjs';

const fx = JSON.parse(readFileSync(new URL('./.fixture.json', import.meta.url), 'utf8'));
const R = fx.runId;

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}
const toast = (page: Page, text: string | RegExp) => expect(page.getByRole('status').filter({ hasText: text }).last()).toBeVisible();

test.describe.serial('R3 administration (UI)', () => {
  let owner: Page;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let buyer: any;
  let itemId = '';

  test.beforeAll(async ({ browser }) => {
    const oc = createClient(url, process.env.E2E_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    ok(await oc.auth.signInWithPassword(fx.owner));
    const buyerRole = await role(oc, fx.companyId, 'uibuyer', ['purchase_order.view', 'purchase_order.create', 'purchase_order.edit',
      'items.view', 'parties.view', 'vendors.view']);
    buyer = await staff(oc, fx.companyId, 'ui-buyer', buyerRole);
    itemId = ok(await oc.from('items').insert({ company_id: fx.companyId, code: `R3UI-${R}`, name: `R3 UI item ${R}`, item_kind: 'RAW_MATERIAL',
      base_unit_id: await unitId('PCS') }).select('id').single()).id;
    owner = await newPage(browser);
    await login(owner, fx.owner);
    await expect(owner).toHaveURL(/\/erp\/$/);
  });

  async function submitPo(qty: number) {
    const saved = ok(await buyer.client.rpc('doc_save', { p_doc_type: 'PURCHASE_ORDER', p_payload: { company_id: fx.companyId,
      doc_date: new Date().toISOString().slice(0, 10), party_id: fx.vendorId,
      lines: [{ item_id: itemId, qty, unit_id: await unitId('PCS'), rate: 10 }] } }));
    return ok(await buyer.client.rpc('doc_submit', { p_doc_type: 'PURCHASE_ORDER', p_id: saved.id ?? saved }));
  }

  test('modules: switch a business module off and on; core modules cannot be switched off', async () => {
    await owner.getByRole('link', { name: 'Modules', exact: true }).click();
    await expect(owner.getByRole('heading', { name: 'Modules' })).toBeVisible();
    await expect(owner.getByTestId('module-ADMINISTRATION').getByRole('switch')).toBeDisabled();
    const purchase = owner.getByTestId('module-PURCHASE').getByRole('switch');
    await purchase.click();
    await toast(owner, 'Purchase switched off');
    await expect(owner.getByRole('link', { name: 'Purchase orders' })).toHaveCount(0);
    await purchase.click();
    await toast(owner, 'Purchase switched on');
    await expect(owner.getByRole('link', { name: 'Purchase orders' })).toBeVisible();
  });

  test('branding: application name and colour apply at once', async () => {
    await owner.getByRole('link', { name: 'Settings', exact: true }).click();
    await owner.getByRole('tab', { name: 'Branding' }).click();
    await owner.getByLabel('Application name').fill(`Rukman ${R}`);
    await owner.getByTestId('settings-save').click();
    await toast(owner, 'Branding settings saved');
    await expect(owner).toHaveTitle(new RegExp(`Rukman ${R}`));
    // the session and the section reload after a save; edit again once both are settled
    await owner.waitForLoadState('networkidle');
    await expect(owner.getByTestId('settings-save')).toBeDisabled();
    await owner.getByLabel('Application name').fill('');
    await expect(owner.getByTestId('settings-save')).toBeEnabled();
    await owner.getByTestId('settings-save').click();
    await toast(owner, 'Branding settings saved');
  });

  test('departments and numbering', async () => {
    await owner.getByRole('link', { name: 'Departments', exact: true }).click();
    await owner.getByLabel('New department').fill(`Stores ${R}`);
    await owner.getByRole('button', { name: 'Add' }).click();
    await toast(owner, 'Department added');
    await expect(owner.getByLabel(`Name Stores ${R}`)).toBeVisible();

    await owner.getByRole('link', { name: 'Numbering', exact: true }).click();
    await owner.getByTestId('seq-PURCHASE_ORDER').getByRole('button').first().click();
    await expect(owner.getByTestId('seq-preview')).toBeVisible();
    await owner.keyboard.press('Escape');
  });

  test('approval rules → inbox: rejection needs a reason, approval posts the document, history kept', async () => {
    await owner.getByRole('link', { name: 'Approval rules', exact: true }).click();
    await owner.getByTestId('rules-PURCHASE_ORDER').getByRole('button', { name: 'Configure' }).click();
    const dlg = owner.getByRole('dialog');
    const req = dlg.getByRole('switch', { name: 'Requires approval' });
    if ((await req.getAttribute('aria-checked')) !== 'true') await req.click();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await toast(owner, 'Approval rules saved');
    await expect(owner.getByTestId('rules-PURCHASE_ORDER')).toContainText('Required');

    const rejected = await submitPo(3);
    const approved = await submitPo(4);
    await owner.getByRole('link', { name: 'Approvals', exact: true }).click();
    const row = owner.getByTestId(`inbox-${rejected.id}`);
    await row.getByRole('button', { name: 'Reject' }).click();
    const rd = owner.getByRole('dialog');
    await expect(rd.getByRole('button', { name: 'Reject' })).toBeDisabled();
    await rd.getByLabel('Reason').fill('Wrong quantity');
    await rd.getByRole('button', { name: 'Reject' }).click();
    await toast(owner, 'Rejected — back to the creator');
    await expect(row).toHaveCount(0);

    await owner.getByTestId(`inbox-${approved.id}`).getByRole('button', { name: 'Approve' }).click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await toast(owner, 'Approved');
    const st = ok(await service.from('purchase_orders').select('id, status').in('id', [rejected.id, approved.id]));
    expect(st.find((p: { id: string }) => p.id === approved.id).status).toBe('OPEN');
    expect(st.find((p: { id: string }) => p.id === rejected.id).status).not.toBe('OPEN');
    const hist = ok(await service.from('approval_actions').select('decision, comment').eq('doc_id', rejected.id).order('id'));
    expect(hist.map((h: { decision: string }) => h.decision)).toEqual(['SUBMITTED', 'REJECTED']);
    expect(hist[1].comment).toBe('Wrong quantity');

    // back to the default (no approval) for the later suites
    await owner.getByRole('link', { name: 'Approval rules', exact: true }).click();
    await owner.getByTestId('rules-PURCHASE_ORDER').getByRole('button', { name: 'Configure' }).click();
    await owner.getByRole('dialog').getByRole('switch', { name: 'Requires approval' }).click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await toast(owner, 'Approval rules saved');
  });

  test('audit log shows the administrator\'s changes', async () => {
    await owner.getByRole('link', { name: 'Audit log', exact: true }).click();
    await expect(owner.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(owner.locator('[data-testid^="audit-"]').first()).toBeVisible();
    await expect(owner.getByRole('cell', { name: 'approval rules', exact: true }).first()).toBeVisible();
  });

  test('an ordinary user sees no administration and no audit trail', async ({ browser }) => {
    const op = await newPage(browser);
    await login(op, fx.operator);
    await expect(op).toHaveURL(/\/erp\/$/);
    for (const name of ['Audit log', 'Modules', 'Approval rules', 'Settings', 'Security & logins']) {
      await expect(op.getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    await op.goto('/erp/admin/audit/');
    await expect(op.locator('[data-testid^="audit-"]')).toHaveCount(0);
    await op.goto('/erp/admin/modules/');
    await expect(op.getByTestId('module-PURCHASE').getByRole('switch')).toHaveCount(0);
  });
});
