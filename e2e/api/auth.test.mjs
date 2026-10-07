// Authentication against the production-like local stack (email confirmation
// ON, OTP template, Mailpit inbox): real email OTP flow, and an attacker who
// signs up with an invited address cannot take over the invitation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anon, company, ok, otpCode, party, runId, service } from '../lib.mjs';

test('email OTP login (real email) claims a staff invitation; unverified sign-up cannot', async () => {
  const { companyId, owner } = await company('AUTH');
  const invited = `manager-${runId}@e2e.test`;
  ok(await owner.client.rpc('user_invite', { p_company_id: companyId, p_email: invited, p_role_code: 'ADMIN' }));

  // attacker: password sign-up with the invited address (never verified)
  const attacker = anon();
  const su = await attacker.auth.signUp({ email: invited, password: 'Attacker-Pw-123!' });
  assert.equal(su.error, null);
  assert.equal(su.data.session, null, 'no session before the email is confirmed');
  const si = await attacker.auth.signInWithPassword({ email: invited, password: 'Attacker-Pw-123!' });
  assert.ok(si.error, 'password login refused for an unconfirmed email');
  const members = ok(await service.from('user_roles').select('user_id').eq('company_id', companyId));
  assert.deepEqual([...new Set(members.map((m) => m.user_id))], [owner.id], 'only the owner is a member');

  // real owner of the mailbox: OTP code by email (auth allows one email per address per second)
  await new Promise((r) => setTimeout(r, 1500));
  const t0 = Date.now() - 200;
  const real = anon();
  ok(await real.auth.signInWithOtp({ email: invited, options: { shouldCreateUser: true } }));
  const code = await otpCode(invited, { after: t0 });
  ok(await real.auth.verifyOtp({ email: invited, token: code, type: 'email' }));
  const boot = ok(await real.rpc('session_bootstrap'));
  assert.equal(boot.companies.length, 1, 'verified user receives the invited role');
  assert.deepEqual(boot.companies[0].roles.sort(), ['ADMIN']);

  // a wrong / reused code is rejected
  const again = anon();
  const bad = await again.auth.verifyOtp({ email: invited, token: code, type: 'email' });
  assert.ok(bad.error, 'used code cannot be reused');
});

test('portal invitation + OTP; anonymous key gets nothing', async () => {
  const { companyId, owner } = await company('AUTH2');
  ok(await service.from('company_settings').update({ customer_portal_enabled: true }).eq('company_id', companyId));
  const cust = await party(owner.client, companyId, 'CUST', 'CUSTOMER');
  const email = `buyer-${runId}@e2e.test`;
  ok(await owner.client.rpc('portal_invite', { p_party_id: cust, p_kind: 'CUSTOMER', p_email: email }));
  const t0 = Date.now() - 1000;
  const c = anon();
  ok(await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
  ok(await c.auth.verifyOtp({ email, token: await otpCode(email, { after: t0 }), type: 'email' }));
  const boot = ok(await c.rpc('session_bootstrap'));
  assert.equal(boot.portals[0].party_id, cust);
  assert.ok(Array.isArray(ok(await c.rpc('portal_catalog', { p_company_id: companyId }))));

  // anonymous (no session): every table / RPC refused or empty
  const a = anon();
  for (const table of ['companies', 'parties', 'items', 'stock_balances', 'company_settings', 'documents', 'email_outbox']) {
    const r = await a.from(table).select('*').limit(1);
    assert.ok(r.error || r.data.length === 0, `anon reads nothing from ${table}`);
  }
  for (const fn of ['portal_catalog', 'session_bootstrap', 'email_claim', 'run_payment_reminders', 'create_company']) {
    const r = await a.rpc(fn, fn === 'portal_catalog' ? { p_company_id: companyId } : {});
    assert.ok(r.error, `anon cannot call ${fn}`);
  }
});
