// User Management Center against the real local stack: the admin-users Edge
// Function + Supabase Auth + the database rules (R1 success criteria 1–6,
// 12–15 at API level). Every call is made with the caller's own session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { anon, company, ok, party, runId, service, url } from '../lib.mjs';

const fnUrl = `${url}/functions/v1/admin-users`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function token(client) {
  return (await client.auth.getSession()).data.session?.access_token;
}
/** Calls the function as the signed-in user of `client`; returns { status, body }. */
async function call(client, body) {
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client ? await token(client) : process.env.E2E_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function signIn(email, password) {
  const c = createClient(url, process.env.E2E_ANON_KEY, opts);
  const r = await c.auth.signInWithPassword({ email, password });
  return { client: c, error: r.error };
}

test('owner creates a user with a temporary password; forced change; disable / enable; reset', async () => {
  const { companyId, owner } = await company('UMC');
  const godowns = ok(await owner.client.from('godowns').insert([
    { company_id: companyId, code: 'GA', name: 'Godown A' }, { company_id: companyId, code: 'GB', name: 'Godown B' }]).select('id, code'));
  const ga = godowns.find((g) => g.code === 'GA').id;
  const gb = godowns.find((g) => g.code === 'GB').id;
  const role = ok(await owner.client.rpc('role_save', { p_company_id: companyId, p_role_id: null,
    p_payload: { code: 'STORE', name: 'Store executive' } }));
  ok(await owner.client.rpc('role_set_permissions', { p_role_id: role,
    p_permissions: ['items.view', 'godowns.view', 'stock_adjustment.view', 'stock_adjustment.create'] }));

  // 1–2 create user + temporary password (shown once)
  const email = `store-${runId}@e2e.test`;
  const created = await call(owner.client, { action: 'create', company_id: companyId,
    payload: { kind: 'INTERNAL', email, full_name: 'Store Keeper', department: 'Stores', role_ids: [role], godown_ids: [ga] } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const temp = created.body.temporary_password;
  assert.match(temp, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16}$/, 'strong 16-character temporary password');

  // the password is nowhere in the application tables / audit
  const audit = ok(await service.from('audit_log').select('old_data, new_data').eq('company_id', companyId));
  assert.ok(!JSON.stringify(audit).includes(temp), 'temporary password is not in the audit log');
  const prof = ok(await service.from('profiles').select('*').eq('id', created.body.user_id).single());
  assert.ok(!JSON.stringify(prof).includes(temp), 'temporary password is not in profiles');
  assert.equal(prof.must_change_password, true);

  // 3–4 login with the temporary password → nothing until it is changed
  const s1 = await signIn(email, temp);
  assert.equal(s1.error, null, 'user logs in with the temporary password');
  const boot = ok(await s1.client.rpc('session_bootstrap'));
  assert.equal(boot.must_change_password, true, 'app is told to force the password change');
  assert.deepEqual(ok(await s1.client.rpc('my_permissions', { p_company_id: companyId })), [], 'no permission before the change');
  assert.deepEqual(ok(await s1.client.from('godowns').select('id')), [], 'no data before the change');
  ok(await s1.client.auth.updateUser({ password: `Own-${runId}-Pw1!` }));
  assert.equal(ok(await s1.client.rpc('session_bootstrap')).must_change_password, false, 'flag cleared by the change');
  assert.ok(ok(await s1.client.rpc('my_permissions', { p_company_id: companyId })).includes('stock_adjustment.create'));

  // 12–14 godown scope enforced by the backend, not by the UI
  const visible = ok(await s1.client.from('godowns').select('id'));
  assert.deepEqual(visible.map((g) => g.id), [ga], 'REST read returns only Godown A');
  const item = ok(await owner.client.from('items').insert({ company_id: companyId, code: `I-${runId}`, name: 'Item',
    item_kind: 'RAW_MATERIAL', base_unit_id: ok(await service.from('units').select('id').is('company_id', null).eq('code', 'PCS'))[0].id })
    .select('id, base_unit_id').single());
  const bad = await s1.client.rpc('doc_save', { p_doc_type: 'STOCK_ADJUSTMENT', p_payload: { company_id: companyId,
    doc_date: '2026-10-01', godown_id: gb, reason: 'STOCK_IN',
    lines: [{ item_id: item.id, direction: 1, qty: 1, unit_id: item.base_unit_id }] } });
  assert.match(bad.error?.message ?? '', /Godown access denied/, 'API call for Godown B rejected');
  const good = await s1.client.rpc('doc_save', { p_doc_type: 'STOCK_ADJUSTMENT', p_payload: { company_id: companyId,
    doc_date: '2026-10-01', godown_id: ga, reason: 'STOCK_IN',
    lines: [{ item_id: item.id, direction: 1, qty: 1, unit_id: item.base_unit_id }] } });
  assert.equal(good.error, null, 'Godown A works');

  // 5–6 disable → live token useless, new login refused
  const dis = await call(owner.client, { action: 'set_status', company_id: companyId, user_id: created.body.user_id, active: false, reason: 'test' });
  assert.equal(dis.status, 200, JSON.stringify(dis.body));
  assert.equal(dis.body.login_blocked, true);
  assert.deepEqual(ok(await s1.client.rpc('my_permissions', { p_company_id: companyId })), [], 'existing token has no permission');
  assert.deepEqual(ok(await s1.client.from('godowns').select('id')), [], 'existing token reads nothing');
  const s2 = await signIn(email, `Own-${runId}-Pw1!`);
  assert.ok(s2.error, 'disabled user cannot log in');
  const en = await call(owner.client, { action: 'set_status', company_id: companyId, user_id: created.body.user_id, active: true });
  assert.equal(en.status, 200);
  assert.equal((await signIn(email, `Own-${runId}-Pw1!`)).error, null, 'enabled user logs in again');

  // reset password → old password invalid, new one temporary
  const reset = await call(owner.client, { action: 'reset_password', company_id: companyId, user_id: created.body.user_id });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.ok((await signIn(email, `Own-${runId}-Pw1!`)).error, 'old password no longer works');
  const s3 = await signIn(email, reset.body.temporary_password);
  assert.equal(s3.error, null);
  assert.equal(ok(await s3.client.rpc('session_bootstrap')).must_change_password, true, 'reset password must be changed');

  // audit trail of the user
  const detail = ok(await owner.client.rpc('admin_user_detail', { p_company_id: companyId, p_user_id: created.body.user_id }));
  const actions = detail.history.map((h) => h.action);
  for (const a of ['CREATE', 'ROLE_ADD', 'DISABLE', 'ENABLE', 'PASSWORD_RESET', 'LOGIN']) assert.ok(actions.includes(a), `audit has ${a}`);
});

test('authorization of the function: anonymous, unauthorized, other company, owner protection', async () => {
  const { companyId, owner } = await company('UMC2');
  const other = await company('UMC3');
  const viewer = ok(await owner.client.rpc('role_save', { p_company_id: companyId, p_role_id: null, p_payload: { code: 'LOOK', name: 'Look' } }));
  ok(await owner.client.rpc('role_set_permissions', { p_role_id: viewer, p_permissions: ['items.view'] }));
  const made = await call(owner.client, { action: 'create', company_id: companyId,
    payload: { kind: 'INTERNAL', email: `look-${runId}@e2e.test`, role_ids: [viewer] } });
  assert.equal(made.status, 200);
  const look = await signIn(`look-${runId}@e2e.test`, made.body.temporary_password);
  ok(await look.client.auth.updateUser({ password: `Look-${runId}-Pw!` }));

  assert.equal((await call(null, { action: 'create', company_id: companyId, payload: {} })).status, 401, 'anonymous key refused');
  const noPerm = await call(look.client, { action: 'create', company_id: companyId,
    payload: { kind: 'INTERNAL', email: `x-${runId}@e2e.test`, role_ids: [viewer] } });
  assert.equal(noPerm.status, 403, 'user without users.create refused');
  const noReset = await call(look.client, { action: 'reset_password', company_id: companyId, user_id: owner.id });
  assert.ok([400, 403].includes(noReset.status), 'user cannot reset the owner password');
  const cross = await call(other.owner.client, { action: 'reset_password', company_id: other.companyId, user_id: made.body.user_id });
  assert.equal(cross.body.error, 'User not found', 'owner of another company cannot touch this user');
  const cross2 = await call(other.owner.client, { action: 'reset_password', company_id: companyId, user_id: made.body.user_id });
  assert.ok([400, 403].includes(cross2.status), 'company_id of another company is not trusted');
  const noPw = await call(owner.client, { action: 'create', company_id: companyId,
    payload: { kind: 'INTERNAL', email: `pw-${runId}@e2e.test`, role_ids: [viewer], password: 'chosen-by-browser' } });
  assert.notEqual(noPw.body.temporary_password, 'chosen-by-browser', 'a password from the browser is ignored');

  // admin (not owner) cannot disable or reset an owner
  const adminRole = ok(await service.from('roles').select('id').eq('company_id', companyId).eq('code', 'ADMIN').single()).id;
  const adm = await call(owner.client, { action: 'create', company_id: companyId,
    payload: { kind: 'INTERNAL', email: `adm-${runId}@e2e.test`, role_ids: [adminRole] } });
  assert.equal(adm.status, 200, JSON.stringify(adm.body));
  const a = await signIn(`adm-${runId}@e2e.test`, adm.body.temporary_password);
  ok(await a.client.auth.updateUser({ password: `Adm-${runId}-Pw!` }));
  const ownerDis = await call(a.client, { action: 'set_status', company_id: companyId, user_id: owner.id, active: false });
  assert.equal(ownerDis.status, 403);
  assert.match(ownerDis.body.error, /Only an owner/);
  assert.equal((await signIn(owner.email, `Pw-${runId}-owner-umc2!`)).error, null, 'owner can still log in');
});

test('customer portal login created from the Users center', async () => {
  const { companyId, owner } = await company('UMC4');
  ok(await service.from('company_settings').update({ customer_portal_enabled: true }).eq('company_id', companyId));
  const cust = await party(owner.client, companyId, 'CUST', 'CUSTOMER');
  const email = `buyer-${runId}@e2e.test`;
  const made = await call(owner.client, { action: 'create', company_id: companyId,
    payload: { kind: 'CUSTOMER', email, party_id: cust, full_name: 'Buyer' } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const b = await signIn(email, made.body.temporary_password);
  assert.equal(b.error, null);
  const denied = await b.client.rpc('portal_context', { p_company_id: companyId, p_kind: 'CUSTOMER' });
  assert.ok(denied.error, 'portal closed until the temporary password is changed');
  ok(await b.client.auth.updateUser({ password: `Buyer-${runId}-Pw!` }));
  const boot = ok(await b.client.rpc('session_bootstrap'));
  assert.equal(boot.portals[0].party_id, cust);
  assert.ok(ok(await b.client.rpc('portal_context', { p_company_id: companyId, p_kind: 'CUSTOMER' })));
  const list = ok(await owner.client.rpc('admin_users', { p_company_id: companyId }));
  assert.ok(list.some((u) => u.kind === 'CUSTOMER' && u.email === email), 'listed in the Users center');
  const anonList = await anon().rpc('admin_users', { p_company_id: companyId });
  assert.ok(anonList.error, 'anonymous cannot list users');
});
