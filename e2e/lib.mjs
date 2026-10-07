// Helpers for the end-to-end tests against the LOCAL Supabase stack.
import { createClient } from '@supabase/supabase-js';

export const url = process.env.E2E_API_URL;
const anonKey = process.env.E2E_ANON_KEY;
const serviceKey = process.env.E2E_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error('E2E_API_URL / E2E_ANON_KEY / E2E_SERVICE_ROLE_KEY missing — run through scripts/e2e/run.sh');
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const service = createClient(url, serviceKey, opts);
export const anon = () => createClient(url, anonKey, opts);
export const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Throws with the PostgREST / storage message when a call failed. */
export function ok(res) {
  if (res.error) throw new Error(res.error.message ?? JSON.stringify(res.error));
  return res.data;
}

/** Creates a confirmed auth user and returns a signed-in client. */
export async function user(label) {
  const email = `${label}-${runId}@e2e.test`;
  const password = `Pw-${runId}-${label}!`;
  const created = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }));
  const client = createClient(url, anonKey, opts);
  ok(await client.auth.signInWithPassword({ email, password }));
  return { id: created.user.id, email, client };
}

/** A company with an owner; returns ids and the owner's client. */
export async function company(code) {
  const owner = await user(`owner-${code}`.toLowerCase());
  const companyId = ok(await service.rpc('create_company', {
    p_payload: { code: `${code}-${runId}`, legal_name: `${code} ${runId} Pvt Ltd`, email: 'office@e2e.test' },
    p_admin_user_id: owner.id,
  }));
  return { companyId, owner };
}

export async function unitId(code) {
  const rows = ok(await service.from('units').select('id').is('company_id', null).eq('code', code));
  return rows[0].id;
}

export async function party(client, companyId, code, role, email = null) {
  const row = ok(await client.from('parties').insert({ company_id: companyId, code: `${code}-${runId}`, name: `${code} ${runId}`, email })
    .select('id').single());
  ok(await client.from('party_roles').insert({ party_id: row.id, role }));
  return row.id;
}

/** Invites a portal user for a party and signs him in (bootstrap links the invite). */
export async function portalUser(ownerClient, partyId, kind, label) {
  const email = `${label}-${runId}@e2e.test`;
  ok(await ownerClient.rpc('portal_invite', { p_party_id: partyId, p_kind: kind, p_email: email }));
  const password = `Pw-${runId}-${label}!`;
  const created = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }));
  const client = createClient(url, anonKey, opts);
  ok(await client.auth.signInWithPassword({ email, password }));
  const boot = ok(await client.rpc('session_bootstrap'));
  return { id: created.user.id, email, client, boot };
}
