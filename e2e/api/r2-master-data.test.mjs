// Platform R2 against the real local stack (PostgREST + Storage + Auth): item
// master field security, rate history, item images, import / export, data
// scopes and portal permissions. Every call is a direct API call with the
// user's own JWT — no UI involved, so nothing relies on the frontend hiding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anon, company, ok, party, portalUser, role, runId, service, staff, unitId } from '../lib.mjs';

const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))], { type: 'image/png' });

async function item(client, companyId, code, extra = {}) {
  return ok(await client.from('items').insert({ company_id: companyId, code: `${code}-${runId}`, name: `${code} ${runId}`,
    item_kind: 'FINISHED_GOOD', base_unit_id: await unitId('PCS'), ...extra }).select('id').single()).id;
}

test('item master: field-level security, rate guard and rate history via the API', async () => {
  const { companyId, owner } = await company('R2I');
  const it = await item(owner.client, companyId, 'ITM', { sale_price: 10, purchase_price: 7 });
  const clerkRole = await role(owner.client, companyId, 'clerk', ['items.view', 'items.edit']);
  const clerk = await staff(owner.client, companyId, 'clerk', clerkRole);

  // base table: the price columns are not readable at all
  assert.ok((await clerk.client.from('items').select('sale_price').eq('id', it)).error, 'items.sale_price column refused');
  assert.ok((await clerk.client.from('items').select('*').eq('id', it)).error, 'select * on items refused (prices are column-protected)');
  const v = ok(await clerk.client.from('v_items').select('code, sale_price, purchase_price, can_view_sale_rate, can_edit_rate').eq('id', it).single());
  assert.deepEqual([v.sale_price, v.purchase_price, v.can_view_sale_rate, v.can_edit_rate], [null, null, false, false], 'v_items masks the rates');
  const own = ok(await owner.client.from('v_items').select('sale_price, purchase_price').eq('id', it).single());
  assert.deepEqual([Number(own.sale_price), Number(own.purchase_price)], [10, 7], 'owner sees the rates');

  // rate guard: editing a rate needs items.edit_rate; other fields are fine
  assert.match((await clerk.client.from('items').update({ sale_price: 1 }).eq('id', it)).error?.message ?? '', /permission|denied|rate/i,
    'clerk cannot change a rate through REST');
  ok(await clerk.client.from('items').update({ notes: 'checked' }).eq('id', it));
  assert.ok((await clerk.client.from('party_item_rates').insert({ company_id: companyId, rate_type: 'SALE', item_id: it, rate: 5 })).error,
    'clerk cannot create a sale rate');
  assert.ok((await clerk.client.from('v_items').update({ name: 'x' }).eq('id', it)).error, 'the masked view is read-only');

  // history: written by the database on every change, readable only with the field right
  ok(await owner.client.from('items').update({ sale_price: 12 }).eq('id', it));
  const hist = ok(await owner.client.from('item_rate_history').select('rate_type, action, old_rate, new_rate').eq('item_id', it).eq('rate_type', 'SALE'));
  assert.ok(hist.some((h) => h.action === 'CHANGE' && Number(h.old_rate) === 10 && Number(h.new_rate) === 12), 'rate change recorded');
  assert.deepEqual(ok(await clerk.client.from('item_rate_history').select('id').eq('item_id', it).in('rate_type', ['SALE', 'PURCHASE'])), [],
    'rate history hidden without the field right');
  assert.ok((await owner.client.from('item_rate_history').update({ new_rate: 1 }).eq('item_id', it)).error
    || ok(await owner.client.from('item_rate_history').select('new_rate').eq('item_id', it).eq('action', 'CHANGE'))[0].new_rate == 12,
    'rate history cannot be rewritten');

  // configurable: grant the sale-rate field right to the role → visible at once
  ok(await owner.client.rpc('role_set_permissions', { p_role_id: clerkRole, p_permissions: ['items.view', 'items.edit', 'items.view_sale_rate'] }));
  const v2 = ok(await clerk.client.from('v_items').select('sale_price, purchase_price').eq('id', it).single());
  assert.deepEqual([Number(v2.sale_price), v2.purchase_price], [12, null], 'sale rate visible, purchase rate still hidden');
});

test('item images: private bucket, permission, item scope and company isolation', async () => {
  const { companyId, owner } = await company('R2P');
  const other = await company('R2P2');
  const it = await item(owner.client, companyId, 'IMG');
  const it2 = await item(owner.client, companyId, 'IMG2');
  const viewer = await staff(owner.client, companyId, 'img-viewer', await role(owner.client, companyId, 'imgview', ['items.view']));
  const scoped = await staff(owner.client, companyId, 'img-scoped', await role(owner.client, companyId, 'imgscope', ['items.view']), { ITEM: [it2] });
  const bucket = (c) => c.storage.from('item-images');
  const path = `${companyId}/${it}/${crypto.randomUUID()}.png`;

  ok(await bucket(owner.client).upload(path, png(), { contentType: 'image/png' }));
  const imageId = ok(await owner.client.rpc('item_image_register', { p_item_id: it, p_payload: {
    storage_path: path, file_name: 'front.png', content_type: 'image/png', size_bytes: 68, is_primary: true } }));
  assert.ok(imageId, 'image registered');
  assert.ok((await owner.client.rpc('item_image_register', { p_item_id: it, p_payload: {
    storage_path: `${companyId}/${it2}/x.png`, file_name: 'x.png', content_type: 'image/png', size_bytes: 1 } })).error, 'path must be the item folder');
  assert.ok((await owner.client.rpc('item_image_register', { p_item_id: it, p_payload: {
    storage_path: `${companyId}/${it}/x.exe`, file_name: 'x.exe', content_type: 'application/x-msdownload', size_bytes: 1 } })).error, 'only image types');

  assert.equal((await bucket(viewer.client).download(path)).error, null, 'user with items.view reads the image');
  const signed = await bucket(viewer.client).createSignedUrl(path, 60);
  assert.equal(signed.error, null, 'signed URL for an allowed user');
  assert.ok((await bucket(viewer.client).upload(`${companyId}/${it}/v.png`, png(), { contentType: 'image/png' })).error,
    'upload refused without items.upload_image');
  assert.ok((await bucket(scoped.client).download(path)).error, 'item outside the user\'s item scope: image refused');
  assert.deepEqual(ok(await scoped.client.from('item_images').select('id').eq('item_id', it)), [], 'image rows of other items hidden');
  assert.ok((await bucket(other.owner.client).download(path)).error, 'other company cannot read');
  assert.ok((await bucket(other.owner.client).upload(`${companyId}/${it}/o.png`, png(), { contentType: 'image/png' })).error,
    'other company cannot upload into this company');
  assert.ok((await bucket(anon()).download(path)).error, 'anonymous cannot read');
  assert.ok((await anon().storage.from('item-images').getPublicUrl(path)).data.publicUrl, 'public URL string exists');
  assert.notEqual((await fetch(anon().storage.from('item-images').getPublicUrl(path).data.publicUrl)).status, 200, 'bucket is not public');

  assert.ok((await viewer.client.rpc('item_image_delete', { p_image_id: imageId })).error, 'delete refused without the right');
  const removed = ok(await owner.client.rpc('item_image_delete', { p_image_id: imageId }));
  assert.equal(removed, path, 'delete returns the storage path');
  ok(await bucket(owner.client).remove([path]));
  assert.ok((await bucket(owner.client).download(path)).error, 'file removed');
});

async function importJob(client, companyId, entity, mode, rows, update = false) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const job = ok(await client.rpc('import_create', { p_company_id: companyId, p_entity: entity, p_file_name: 'api.xlsx', p_mode: mode,
    p_update_existing: update, p_columns: cols }));
  ok(await client.rpc('import_add_rows', { p_job_id: job.job_id, p_rows: rows.map((data, i) => ({ row_no: i + 2, data })) }));
  return { id: job.job_id, preview: ok(await client.rpc('import_validate', { p_job_id: job.job_id })) };
}

test('import / export through the API: preview, all-or-nothing, valid-only, permissions, scope, cross-company', async () => {
  const { companyId, owner } = await company('R2X');
  const other = await company('R2X2');
  const rows = [
    { code: `IA-${runId}`, name: 'Import A', item_kind: 'FINISHED_GOOD', base_unit: 'PCS', sale_price: '9.5' },
    { code: `IB-${runId}`, name: 'Import B', item_kind: 'WOOD', base_unit: 'PCS' },
    { code: `ia-${runId}`, name: 'Duplicate of A', item_kind: 'PACKING', base_unit: 'PCS' }];

  const aon = await importJob(owner.client, companyId, 'ITEMS', 'ALL_OR_NOTHING', rows);
  assert.deepEqual([aon.preview.total_rows, aon.preview.valid_rows, aon.preview.invalid_rows, aon.preview.duplicate_rows], [3, 1, 2, 1], 'preview counts');
  const errs = ok(await owner.client.from('import_errors').select('row_no, column_key, value, message').eq('job_id', aon.id).order('row_no'));
  assert.ok(errs.some((e) => e.row_no === 3 && e.column_key === 'item_kind' && e.value === 'WOOD'), 'error has row, column, value');
  assert.ok(errs.some((e) => e.row_no === 4 && /Duplicate of row 2/.test(e.message)), 'duplicate in the file reported');
  assert.ok((await owner.client.rpc('import_commit', { p_job_id: aon.id, p_confirm: false })).error, 'explicit confirmation required');
  assert.equal(ok(await owner.client.rpc('import_commit', { p_job_id: aon.id, p_confirm: true })).committed, false, 'all-or-nothing refuses');
  assert.deepEqual(ok(await owner.client.from('items').select('id').ilike('code', `I_-${runId}`)), [], 'nothing written');

  const vo = await importJob(owner.client, companyId, 'ITEMS', 'VALID_ONLY', rows);
  assert.equal(ok(await owner.client.rpc('import_commit', { p_job_id: vo.id, p_confirm: true })).imported_rows, 1, 'valid rows only: 1 imported');
  assert.equal(ok(await owner.client.from('items').select('code').ilike('code', `I_-${runId}`)).length, 1);

  // permissions: no import / export rights → refused by the database
  const viewer = await staff(owner.client, companyId, 'x-viewer', await role(owner.client, companyId, 'xview', ['items.view']));
  assert.match((await viewer.client.rpc('import_create', { p_company_id: companyId, p_entity: 'ITEMS', p_file_name: 'x', p_mode: 'ALL_OR_NOTHING',
    p_update_existing: false, p_columns: ['code'] })).error?.message ?? '', /items\.import/, 'import refused without items.import');
  assert.match((await viewer.client.rpc('export_rows', { p_company_id: companyId, p_entity: 'ITEMS' })).error?.message ?? '', /items\.export/,
    'export refused without items.export');
  assert.ok((await viewer.client.rpc('import_validate', { p_job_id: vo.id })).error, 'another user\'s job is not reachable');
  assert.deepEqual(ok(await viewer.client.from('import_jobs').select('id')), [], 'import jobs of others invisible');

  // scoped export: only the items in scope, no rates without the field right
  const keep = await item(owner.client, companyId, 'KEEP', { sale_price: 3 });
  await item(owner.client, companyId, 'HIDE', { sale_price: 4 });
  const exporter = await staff(owner.client, companyId, 'x-exp', await role(owner.client, companyId, 'xexp', ['items.view', 'items.export']), { ITEM: [keep] });
  const out = ok(await exporter.client.rpc('export_rows', { p_company_id: companyId, p_entity: 'ITEMS' }));
  assert.deepEqual(out.map((r) => r.code), [`KEEP-${runId}`], 'export limited to the item scope');
  assert.equal(out[0].sale_price ?? null, null, 'export masks the sale rate');
  assert.deepEqual(ok(await exporter.client.rpc('export_rows', { p_company_id: companyId, p_entity: 'ITEM_RATES' })), [], 'no rate export without rate rights');
  assert.ok(ok(await owner.client.from('export_log').select('entity, row_count').eq('company_id', companyId)).some((l) => l.entity === 'ITEMS'),
    'exports are logged');

  // cross-company
  assert.ok((await other.owner.client.rpc('export_rows', { p_company_id: companyId, p_entity: 'ITEMS' })).error, 'cross-company export refused');
  assert.ok((await other.owner.client.rpc('import_create', { p_company_id: companyId, p_entity: 'ITEMS', p_file_name: 'x',
    p_mode: 'ALL_OR_NOTHING', p_update_existing: false, p_columns: ['code'] })).error, 'cross-company import refused');
  assert.ok((await other.owner.client.rpc('import_commit', { p_job_id: vo.id, p_confirm: true })).error, 'cross-company commit refused');
});

test('customer / vendor / item data scopes via direct API calls', async () => {
  const { companyId, owner } = await company('R2S');
  const custA = await party(owner.client, companyId, 'CA', 'CUSTOMER');
  const custB = await party(owner.client, companyId, 'CB', 'CUSTOMER');
  const vend = await party(owner.client, companyId, 'VA', 'SUPPLIER');
  const it1 = await item(owner.client, companyId, 'S1');
  const it2 = await item(owner.client, companyId, 'S2');
  const sales = await staff(owner.client, companyId, 'scoped-sales',
    await role(owner.client, companyId, 'salesx', ['parties.view', 'parties.edit', 'items.view', 'customer_po.view', 'sales_order.view', 'purchase_order.view']),
    { CUSTOMER: [custA], VENDOR: ['00000000-0000-0000-0000-000000000000'], ITEM: [it1] });

  const ids = ok(await sales.client.from('parties').select('id').in('id', [custA, custB, vend])).map((r) => r.id);
  assert.deepEqual(ids, [custA], 'only customer A; customer B (selected scope) and the vendor (no access) hidden');
  assert.deepEqual(ok(await sales.client.from('parties').select('id').eq('id', custB)), [], 'direct read of customer B by id: nothing');
  assert.deepEqual(ok(await sales.client.from('parties').update({ notes: 'x' }).eq('id', custB).select('id')), [], 'update of customer B: no row');
  assert.ok((await sales.client.rpc('party_save', { p_company_id: companyId, p_id: custB, p_payload: { name: 'hack' } })).error, 'party_save refused for B');
  assert.deepEqual(ok(await sales.client.from('items').select('id').in('id', [it1, it2])).map((r) => r.id), [it1], 'item scope');
  assert.deepEqual(ok(await sales.client.from('v_items').select('id').eq('id', it2)), [], 'masked view honours the item scope');
  assert.ok((await sales.client.from('party_addresses').insert({ party_id: custB, code: 'X', name: 'X', address_type: 'SHIP_TO' })).error,
    'cannot add an address to a customer outside the scope');

  // the owner changes the scope in the "UI" (same RPC) → effective at once
  ok(await owner.client.rpc('user_set_scope', { p_company_id: companyId, p_user_id: sales.id, p_dimension: 'CUSTOMER', p_entity_ids: [] }));
  assert.equal(ok(await sales.client.from('parties').select('id').in('id', [custA, custB])).length, 2, 'full customer access after the change');
});

test('portal permissions per customer: catalogue, rates, stock, PO creation', async () => {
  const { companyId, owner } = await company('R2Q');
  // company settings show rates and stock; the portal role narrows it per customer
  ok(await service.from('company_settings').update({ customer_portal_enabled: true, customer_rate_visible: true,
    customer_stock_visibility: 'EXACT_QUANTITY' }).eq('company_id', companyId));
  await item(owner.client, companyId, 'CAT', { sale_price: 20 });
  const custA = await party(owner.client, companyId, 'PA', 'CUSTOMER');
  const custB = await party(owner.client, companyId, 'PB', 'CUSTOMER');
  const a = await portalUser(owner.client, custA, 'CUSTOMER', 'portal-ra');
  const b = await portalUser(owner.client, custB, 'CUSTOMER', 'portal-rb');
  // Customer A: catalogue + rates, stock hidden, may create POs; Customer B: invoices / payments only
  const roleA = await role(owner.client, companyId, 'pa', ['portal_customer.catalog', 'portal_customer.view_rates', 'portal_customer.create_po',
    'portal_customer.view_pos', 'portal_customer.view_invoices', 'portal_customer.view_payments'], 'CUSTOMER_PORTAL');
  const roleB = await role(owner.client, companyId, 'pb', ['portal_customer.view_invoices', 'portal_customer.view_payments'], 'CUSTOMER_PORTAL');
  assert.ok((await owner.client.rpc('role_set_permissions', { p_role_id: roleB, p_permissions: ['items.view'] })).error,
    'internal permissions cannot be given to a portal role');
  const puA = ok(await owner.client.from('portal_users').select('id').eq('party_id', custA).single()).id;
  const puB = ok(await owner.client.from('portal_users').select('id').eq('party_id', custB).single()).id;
  ok(await owner.client.rpc('portal_user_set_role', { p_portal_user_id: puA, p_role_id: roleA }));
  ok(await owner.client.rpc('portal_user_set_role', { p_portal_user_id: puB, p_role_id: roleB }));

  const ctxA = ok(await a.client.rpc('portal_context', { p_company_id: companyId, p_kind: 'CUSTOMER' }));
  assert.ok(ctxA.features.includes('portal_customer.catalog') && !ctxA.features.includes('portal_customer.view_stock'), 'features of A');
  const catA = ok(await a.client.rpc('portal_catalog', { p_company_id: companyId, p_search: null }));
  assert.ok(catA.some((r) => Number(r.price) === 20), 'A sees the rate');
  assert.ok(catA.length > 0 && catA.every((r) => r.stock?.visibility === 'HIDDEN' && r.stock?.qty === undefined), 'A does not see stock');
  // granting view_stock to A's role shows stock — configuration, not code
  ok(await owner.client.rpc('role_set_permissions', { p_role_id: roleA, p_permissions: ['portal_customer.catalog', 'portal_customer.view_rates',
    'portal_customer.view_stock', 'portal_customer.create_po'] }));
  assert.ok(ok(await a.client.rpc('portal_catalog', { p_company_id: companyId, p_search: null })).every((r) => r.stock?.visibility !== 'HIDDEN'),
    'A sees stock after the role change');

  assert.match((await b.client.rpc('portal_catalog', { p_company_id: companyId, p_search: null })).error?.message ?? '',
    /not enabled/, 'B: catalogue refused by the database');
  assert.match((await b.client.rpc('portal_my_customer_pos', { p_company_id: companyId })).error?.message ?? '', /not enabled/, 'B: POs refused');
  assert.equal((await b.client.rpc('portal_my_invoices', { p_company_id: companyId })).error, null, 'B: invoices allowed');
  assert.ok((await b.client.rpc('portal_user_set_role', { p_portal_user_id: puB, p_role_id: roleA })).error, 'portal user cannot change his own role');
  // portal logins get nothing from the internal tables
  assert.deepEqual(ok(await a.client.from('items').select('id')), [], 'no direct item table access for portal users');
  assert.deepEqual(ok(await a.client.from('parties').select('id').eq('id', custB)), [], 'no access to another customer');
});
