// Platform R3 against the real local stack (PostgREST + Storage + Auth + the
// admin-users Edge Function): modules, settings sections, branding storage,
// company password policy, audit, financial masking, record scope, large
// imports (queued, committed by the worker's service call), approvals and
// cross-company isolation. Every call is a direct API call with the user's own
// JWT — nothing relies on the frontend hiding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { anon, company, ok, party, role, runId, service, staff, unitId, url } from '../lib.mjs';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))], { type: 'image/png' });

async function item(client, companyId, code, extra = {}) {
  return ok(await client.from('items').insert({ company_id: companyId, code: `${code}-${runId}`, name: `${code} ${runId}`,
    item_kind: 'FINISHED_GOOD', base_unit_id: await unitId('PCS'), ...extra }).select('id').single()).id;
}
async function callFn(client, body) {
  const token = (await client.auth.getSession()).data.session?.access_token;
  const res = await fetch(`${url}/functions/v1/admin-users`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function po(client, companyId, vendor, it, qty, rate) {
  const saved = ok(await client.rpc('doc_save', { p_doc_type: 'PURCHASE_ORDER', p_payload: { company_id: companyId,
    doc_date: new Date().toISOString().slice(0, 10), party_id: vendor,
    lines: [{ item_id: it, qty, unit_id: await unitId('PCS'), rate }] } }));
  return ok(await client.rpc('doc_submit', { p_doc_type: 'PURCHASE_ORDER', p_id: saved.id ?? saved }));
}

test('modules are enforced by the database; core modules stay on; the owner keeps the recovery path', async () => {
  const { companyId, owner } = await company('R3M');
  const vendor = await party(owner.client, companyId, 'V', 'SUPPLIER');
  const it = await item(owner.client, companyId, 'MOD');
  await po(owner.client, companyId, vendor, it, 1, 10);
  const clerk = await staff(owner.client, companyId, 'mod-clerk', await role(owner.client, companyId, 'modclerk', ['purchase_order.view', 'items.view']));

  assert.match((await owner.client.rpc('module_set', { p_company_id: companyId, p_module: 'ADMINISTRATION', p_enabled: false })).error?.message ?? '',
    /always on/, 'core module cannot be disabled');
  assert.ok((await clerk.client.rpc('module_set', { p_company_id: companyId, p_module: 'PURCHASE', p_enabled: false })).error,
    'only an administrator switches modules');
  ok(await owner.client.rpc('module_set', { p_company_id: companyId, p_module: 'PURCHASE', p_enabled: false }));
  assert.deepEqual(ok(await clerk.client.from('purchase_orders').select('id').eq('company_id', companyId)), [], 'REST read returns nothing');
  assert.deepEqual(ok(await owner.client.from('purchase_orders').select('id').eq('company_id', companyId)), [], 'also for the owner');
  assert.ok((await owner.client.rpc('doc_save', { p_doc_type: 'PURCHASE_ORDER', p_payload: { company_id: companyId,
    doc_date: '2026-10-10', party_id: vendor, lines: [] } })).error, 'document action refused');
  const list = ok(await owner.client.rpc('company_modules_list', { p_company_id: companyId }));
  assert.ok(list.some((m) => m.code === 'PURCHASE' && !m.is_enabled), 'owner still sees the module list');
  ok(await owner.client.rpc('module_set', { p_company_id: companyId, p_module: 'PURCHASE', p_enabled: true }));
  assert.equal(ok(await clerk.client.from('purchase_orders').select('id').eq('company_id', companyId)).length, 1, 're-enabled: data back');
});

test('settings sections, branding storage, company password policy (Edge Function)', async () => {
  const { companyId, owner } = await company('R3S');
  const other = await company('R3S2');
  const viewer = await staff(owner.client, companyId, 'set-viewer', await role(owner.client, companyId, 'setview', ['settings_security.view']));

  const mine = ok(await viewer.client.rpc('settings_get', { p_company_id: companyId }));
  assert.deepEqual(Object.keys(mine), ['security'], 'only the sections the user may view');
  assert.equal(mine.security.can_edit, false);
  assert.ok((await viewer.client.rpc('settings_save', { p_company_id: companyId, p_section: 'security', p_payload: { password_min_length: 14 } })).error,
    'saving refused without the edit right');
  assert.ok((await other.owner.client.rpc('settings_get', { p_company_id: companyId })).error, 'other company refused');
  ok(await owner.client.rpc('settings_save', { p_company_id: companyId, p_section: 'security', p_payload: { password_min_length: 14 } }));
  assert.ok((await owner.client.rpc('settings_save', { p_company_id: companyId, p_section: 'branding',
    p_payload: { logo_path: `${other.companyId}/logo.png` } })).error, 'logo must be in the company\'s own folder');

  // branding files: private bucket, own company folder, edit right, size / type limits
  const bucket = (c) => c.storage.from('company-assets');
  const path = `${companyId}/logo-${runId}.png`;
  ok(await bucket(owner.client).upload(path, png(), { contentType: 'image/png' }));
  ok(await owner.client.rpc('settings_save', { p_company_id: companyId, p_section: 'branding', p_payload: { logo_path: path, primary_color: '#336699' } }));
  assert.equal((await bucket(viewer.client).download(path)).error, null, 'members read the branding files');
  assert.ok((await bucket(viewer.client).upload(`${companyId}/v-${runId}.png`, png(), { contentType: 'image/png' })).error,
    'upload refused without settings_branding.edit');
  assert.ok((await bucket(other.owner.client).download(path)).error, 'other company cannot read');
  assert.ok((await bucket(other.owner.client).upload(`${companyId}/x-${runId}.png`, png(), { contentType: 'image/png' })).error,
    'other company cannot write into the folder');
  assert.ok((await bucket(anon()).download(path)).error, 'anonymous cannot read');
  assert.ok((await bucket(owner.client).upload(`${companyId}/x-${runId}.svg`, new Blob(['<svg/>'], { type: 'image/svg+xml' }),
    { contentType: 'image/svg+xml' })).error, 'SVG refused');
  assert.ok((await bucket(owner.client).upload(`${companyId}/big-${runId}.png`, new Blob([new Uint8Array(1024 * 1024 + 10)], { type: 'image/png' }),
    { contentType: 'image/png' })).error, 'files over 1 MB refused');
  const boot = ok(await viewer.client.rpc('session_bootstrap'));
  assert.equal(JSON.stringify(boot).includes('#336699'), true, 'branding sent with the session');

  // company password policy through the Edge Function (AC-6.1)
  const short = await callFn(viewer.client, { action: 'change_password', password: 'Abcdef-12345' });
  assert.equal(short.status, 400, 'a 12-character password is below the company minimum of 14');
  assert.match(short.body.error, /14/);
  const good = await callFn(viewer.client, { action: 'change_password', password: `Long-${runId}-Pass!` });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  const again = createClient(url, process.env.E2E_ANON_KEY, opts);
  assert.equal((await again.auth.signInWithPassword({ email: viewer.email, password: `Long-${runId}-Pass!` })).error, null, 'new password works');
});

test('audit: request metadata, permission, masking, company isolation, no secrets', async () => {
  const { companyId, owner } = await company('R3A');
  const other = await company('R3A2');
  const it = await item(owner.client, companyId, 'AUD', { sale_price: 10, purchase_price: 7 });
  ok(await owner.client.from('items').update({ sale_price: 11, purchase_price: 8 }).eq('id', it));
  const auditor = await staff(owner.client, companyId, 'auditor', await role(owner.client, companyId, 'auditor', ['audit.view', 'items.view']));
  const nobody = await staff(owner.client, companyId, 'aud-none', await role(owner.client, companyId, 'audnone', ['items.view']));

  const own = ok(await owner.client.rpc('audit_search', { p_company_id: companyId, p_filters: { table_name: 'items', row_id: it } }));
  assert.ok(own.length >= 2, 'insert and update audited');
  assert.ok(own.some((a) => a.request_meta?.user_agent), 'request metadata (user agent) recorded');
  assert.ok(own.some((a) => a.new_data?.sale_price == 11), 'owner sees the values');

  const rows = ok(await auditor.client.rpc('audit_search', { p_company_id: companyId, p_filters: { table_name: 'items', row_id: it } }));
  assert.ok(rows.length >= 2, 'auditor reads the trail');
  assert.ok(rows.every((a) => [undefined, null, '•••'].includes(a.new_data?.sale_price) && [undefined, null, '•••'].includes(a.new_data?.purchase_price)),
    'rates masked in the audit trail without the rate rights');
  assert.deepEqual(ok(await nobody.client.rpc('audit_search', { p_company_id: companyId, p_filters: {} })), [], 'nothing without audit.view');
  assert.deepEqual(ok(await nobody.client.from('audit_log').select('id').eq('company_id', companyId)), [], 'audit_log table: nothing either');
  assert.ok((await auditor.client.rpc('audit_export', { p_company_id: companyId, p_filters: {} })).error, 'export needs audit.export');
  assert.deepEqual(ok(await other.owner.client.rpc('audit_search', { p_company_id: companyId, p_filters: {} })), [], 'other company sees nothing');
  const upd = await owner.client.from('audit_log').update({ action: 'X' }).eq('company_id', companyId).select('id');
  assert.ok(upd.error || upd.data.length === 0, 'audit log cannot be rewritten');

  // passwords / tokens never reach the audit log
  const all = JSON.stringify(ok(await owner.client.rpc('audit_search', { p_company_id: companyId, p_filters: {}, p_limit: 500 })));
  assert.ok(!/encrypted_password|access_token|refresh_token|Pw-/.test(all), 'no credentials in the audit trail');
});

test('financial masking via REST: purchase rate, valuation, cost summary', async () => {
  const { companyId, owner } = await company('R3F');
  const it = await item(owner.client, companyId, 'FIN', { sale_price: 20, purchase_price: 9 });
  const clerk = await staff(owner.client, companyId, 'fin-clerk', await role(owner.client, companyId, 'finclerk', ['items.view', 'reports.view']));
  const valuer = await staff(owner.client, companyId, 'fin-val', await role(owner.client, companyId, 'finval',
    ['items.view', 'reports.view', 'costs.view_stock_valuation']));

  assert.ok((await clerk.client.rpc('stock_valuation', { p_company_id: companyId, p_as_on: '2026-12-31' })).error, 'valuation refused');
  assert.ok((await valuer.client.rpc('stock_valuation', { p_company_id: companyId, p_as_on: '2026-12-31' })).error,
    'valuation also needs the average-cost right (no inference)');
  assert.equal((await owner.client.rpc('stock_valuation', { p_company_id: companyId, p_as_on: '2026-12-31' })).error, null, 'owner may value stock');
  assert.ok((await clerk.client.from('item_cost_summary').select('*').eq('item_id', it)).error, 'cost summary not readable directly');
  const v = ok(await clerk.client.from('v_items').select('purchase_price, sale_price').eq('id', it).single());
  assert.deepEqual([v.purchase_price, v.sale_price], [null, null], 'rates masked in the item view');
});

test('record scope OWN, department and cross-company over REST', async () => {
  const { companyId, owner } = await company('R3R');
  const other = await company('R3R2');
  const vendor = await party(owner.client, companyId, 'V', 'SUPPLIER');
  const it = await item(owner.client, companyId, 'RSC');
  const buyerRole = await role(owner.client, companyId, 'buyer', ['purchase_order.view', 'purchase_order.create', 'purchase_order.edit',
    'items.view', 'parties.view', 'vendors.view']);
  const a = await staff(owner.client, companyId, 'buyer-a', buyerRole);
  const b = await staff(owner.client, companyId, 'buyer-b', buyerRole);
  await po(owner.client, companyId, vendor, it, 1, 5);
  await po(a.client, companyId, vendor, it, 2, 5);
  assert.equal(ok(await b.client.from('purchase_orders').select('id').eq('company_id', companyId)).length, 2, 'ALL: everything visible');
  ok(await owner.client.rpc('user_set_record_scope', { p_company_id: companyId, p_user_id: b.id, p_scope: 'OWN' }));
  assert.deepEqual(ok(await b.client.from('purchase_orders').select('id').eq('company_id', companyId)), [], 'OWN: others\' documents hidden');
  await po(b.client, companyId, vendor, it, 3, 5);
  assert.equal(ok(await b.client.from('purchase_orders').select('id').eq('company_id', companyId)).length, 1, 'OWN: own document visible');
  assert.ok((await b.client.rpc('user_set_record_scope', { p_company_id: companyId, p_user_id: b.id, p_scope: 'ALL' })).error,
    'a user cannot widen his own scope');
  assert.deepEqual(ok(await other.owner.client.from('purchase_orders').select('id').eq('company_id', companyId)), [], 'other company sees nothing');
});

test('approvals: thresholds, no self-approval, rejection reason, history, cross-company', async () => {
  const { companyId, owner } = await company('R3P');
  const other = await company('R3P2');
  const vendor = await party(owner.client, companyId, 'V', 'SUPPLIER');
  const it = await item(owner.client, companyId, 'APR');
  const buyer = await staff(owner.client, companyId, 'apr-buyer', await role(owner.client, companyId, 'aprbuyer',
    ['purchase_order.view', 'purchase_order.create', 'purchase_order.edit', 'purchase_order.approve', 'items.view', 'parties.view', 'vendors.view']));
  const mgr = await staff(owner.client, companyId, 'apr-mgr', await role(owner.client, companyId, 'aprmgr',
    ['purchase_order.view', 'purchase_order.approve', 'items.view']));
  ok(await owner.client.rpc('approval_rules_save', { p_company_id: companyId, p_doc_type: 'PURCHASE_ORDER', p_requires: true,
    p_levels: [{ approver_permission: 'purchase_order.approve', min_amount: 1000 }] }));
  assert.ok((await buyer.client.rpc('approval_rules_save', { p_company_id: companyId, p_doc_type: 'PURCHASE_ORDER', p_requires: false,
    p_levels: [] })).error, 'rules need the Approvals settings right');

  const small = await po(buyer.client, companyId, vendor, it, 1, 10);
  const big = await po(buyer.client, companyId, vendor, it, 100, 50);
  const status = async (id) => ok(await owner.client.from('purchase_orders').select('status').eq('id', id).single()).status;
  assert.equal(await status(small.id), 'OPEN', 'below the threshold: posted directly');
  assert.equal(await status(big.id), 'PENDING_APPROVAL', 'above the threshold: waits');
  assert.ok((await buyer.client.rpc('approval_approve', { p_doc_type: 'PURCHASE_ORDER', p_id: big.id })).error, 'maker cannot approve');
  assert.ok((await other.owner.client.rpc('approval_approve', { p_doc_type: 'PURCHASE_ORDER', p_id: big.id })).error, 'other company refused');
  assert.ok((await mgr.client.rpc('approval_reject', { p_doc_type: 'PURCHASE_ORDER', p_id: big.id, p_reason: ' ' })).error, 'reason mandatory');
  const inbox = ok(await mgr.client.rpc('approval_inbox', { p_company_id: companyId }));
  assert.ok(inbox.some((x) => x.id === big.id), 'manager inbox lists the PO');
  assert.ok(inbox.every((x) => x.amount == null), 'amount hidden without the purchase-rate right');
  assert.equal(ok(await mgr.client.rpc('approval_approve', { p_doc_type: 'PURCHASE_ORDER', p_id: big.id, p_comment: 'ok' })).status, 'OPEN');
  const hist = ok(await owner.client.from('approval_actions').select('decision').eq('doc_id', big.id).order('id'));
  assert.deepEqual(hist.map((h) => h.decision), ['SUBMITTED', 'APPROVED'], 'history kept');
  assert.ok((await service.from('approval_actions').delete().eq('doc_id', big.id)).error, 'history immutable');
});

// AC-11.5 through the real gateway timeouts: every call of the importer must finish within authenticated's 8 s,
// the worker commits through PostgREST as service_role (own statement timeout, R4 fix)
test('10,000-row import: user calls within 8 s, queued, committed by the worker as the importer', async () => {
  const { companyId, owner } = await company('R3I');
  const other = await company('R3I2');
  const n = 10000;
  const job = ok(await owner.client.rpc('import_create', { p_company_id: companyId, p_entity: 'ITEMS', p_file_name: 'big.xlsx',
    p_mode: 'ALL_OR_NOTHING', p_update_existing: false, p_columns: ['code', 'name', 'item_kind', 'base_unit'] }));
  for (let o = 0; o < n; o += 1000) {
    const rows = Array.from({ length: Math.min(1000, n - o) }, (_, i) => ({ row_no: o + i + 2,
      data: { code: `Q${o + i}-${runId}`, name: `Queued ${o + i}`, item_kind: 'FINISHED_GOOD', base_unit: 'PCS' } }));
    ok(await owner.client.rpc('import_add_rows', { p_job_id: job.job_id, p_rows: rows }));
  }
  assert.equal(ok(await owner.client.rpc('import_validate', { p_job_id: job.job_id })).valid_rows, n);
  assert.ok((await other.owner.client.rpc('import_commit', { p_job_id: job.job_id, p_confirm: true })).error, 'other company refused');
  assert.equal(ok(await owner.client.rpc('import_commit', { p_job_id: job.job_id, p_confirm: true })).status, 'QUEUED', 'large import queued');
  assert.ok((await owner.client.rpc('import_claim_next')).error, 'users cannot claim queued jobs');
  assert.ok((await owner.client.rpc('import_commit_job', { p_job_id: job.job_id })).error, 'users cannot run the queue');
  const claimed = ok(await service.rpc('import_claim_next'));
  assert.equal(claimed, job.job_id, 'the worker claims the job');
  const started = Date.now();
  const done = ok(await service.rpc('import_commit_job', { p_job_id: claimed }));
  console.log(`# worker commit of ${n} rows through PostgREST: ${Date.now() - started} ms`);
  assert.equal(done.job_id, job.job_id);
  assert.equal(done.imported_rows, n, 'worker committed every row');
  const items = ok(await owner.client.from('items').select('id, created_by').ilike('code', `Q%-${runId}`).limit(5));
  assert.equal(items[0].created_by, owner.id, 'rows are owned by the importer, not the service');
  assert.equal(ok(await service.rpc('import_claim_next')), null, 'queue empty');
});
