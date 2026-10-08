// admin-users — privileged login operations for the User Management Center.
//
// Runs as a Supabase Edge Function in the same project as the database; the
// service-role key exists only in the function environment (never in the
// browser, never in the repository). Every business rule — who may create,
// reset, disable whom, which roles / scopes are allowed, owner protection,
// company isolation — is checked by the database RPCs, called WITH THE
// CALLER'S OWN JWT. The service role is used only for the Auth admin API
// (create login, set password, ban) after the database said yes.
//
// Passwords: a temporary password is generated here, set in Supabase Auth
// (stored there only as a hash) and returned once in the response. It is
// never written to an application table and never logged.
//
// No dependencies: plain fetch against the project's Auth and PostgREST
// endpoints (nothing downloaded at cold start, nothing to audit). No
// runtime-specific code either, so the same file runs under Deno (index.ts)
// and under Node for tests.

export interface Env {
  url: string;
  anonKey: string;
  serviceKey: string;
  fetch?: typeof fetch;
}

interface DbResult<T = any> { data: T; error: { message: string; code?: string } | null }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = '876000h';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Database error → HTTP error with the business message (no internals). */
function dbError(error: { message?: string; code?: string } | null): never {
  const status = error?.code === '42501' ? 403 : 400;
  throw new HttpError(status, (error?.message ?? 'Request failed').replace(/^ERROR:\s*/, ''));
}

// -----------------------------------------------------------------------------
// Minimal REST client
// -----------------------------------------------------------------------------
class Api {
  private f: typeof fetch;
  constructor(private env: Env) { this.f = env.fetch ?? fetch; }

  private async call(path: string, method: string, token: string, apikey: string, body?: unknown): Promise<DbResult> {
    const res = await this.f(`${this.env.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, apikey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      return { data: null, error: { message: data?.message ?? data?.msg ?? data?.error_description ?? `HTTP ${res.status}`,
                                    code: data?.code ?? String(res.status) } };
    }
    return { data, error: null };
  }

  /** RPC with the caller's JWT: the database sees auth.uid() = caller. */
  rpcAsUser(jwt: string, fn: string, args: Record<string, unknown>) {
    return this.call(`/rest/v1/rpc/${fn}`, 'POST', jwt, this.env.anonKey, args);
  }
  rpcAsService(fn: string, args: Record<string, unknown>) {
    return this.call(`/rest/v1/rpc/${fn}`, 'POST', this.env.serviceKey, this.env.serviceKey, args);
  }
  getUser(jwt: string) {
    return this.call('/auth/v1/user', 'GET', jwt, this.env.anonKey);
  }
  createUser(body: Record<string, unknown>) {
    return this.call('/auth/v1/admin/users', 'POST', this.env.serviceKey, this.env.serviceKey, body);
  }
  updateUser(id: string, body: Record<string, unknown>) {
    return this.call(`/auth/v1/admin/users/${id}`, 'PUT', this.env.serviceKey, this.env.serviceKey, body);
  }
  deleteUser(id: string) {
    return this.call(`/auth/v1/admin/users/${id}`, 'DELETE', this.env.serviceKey, this.env.serviceKey);
  }
}

// -----------------------------------------------------------------------------
// Temporary passwords
// -----------------------------------------------------------------------------
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '!@#$%*-_+=?';

/** Uniform random integer 0 ≤ n < max from the CSPRNG (rejection sampling, no modulo bias). */
function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}
const pick = (set: string) => set[randomInt(set.length)];

/** Strong temporary password: 16 characters, all four character classes. */
export function generatePassword(length = 16): string {
  const all = UPPER + LOWER + DIGIT + SYMBOL;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {          // Fisher–Yates shuffle
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function requireUuid(v: unknown, name: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, `${name} is required`);
  return v;
}

// -----------------------------------------------------------------------------
// Request handler
// -----------------------------------------------------------------------------
export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  let action = 'unknown';
  try {
    if (!env.url || !env.anonKey || !env.serviceKey) throw new Error('function environment incomplete');
    const auth = req.headers.get('Authorization') ?? '';
    const jwt = auth.match(/^Bearer\s+(\S+)$/)?.[1];
    if (!jwt) throw new HttpError(401, 'Not signed in');
    const text = await req.text();
    if (text.length > 20_000) throw new HttpError(413, 'Request too large');
    let body: Record<string, any>;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid request');

    const api = new Api(env);
    // The caller's identity comes from the token verified by Supabase Auth,
    // never from the request body.
    const who = await api.getUser(jwt);
    if (who.error || !who.data?.id) throw new HttpError(401, 'Not signed in');

    const companyId = requireUuid(body.company_id, 'company_id');
    action = String(body.action ?? 'unknown').slice(0, 40);
    switch (body.action) {
      case 'create':
        return json(200, await createUser(api, jwt, companyId, body.payload));
      case 'reset_password':
        return json(200, await resetPassword(api, jwt, companyId, requireUuid(body.user_id, 'user_id')));
      case 'set_status':
        return json(200, await setStatus(api, jwt, companyId, requireUuid(body.user_id, 'user_id'), body.active === true,
                                         typeof body.reason === 'string' ? body.reason.slice(0, 500) : null));
      default:
        throw new HttpError(400, 'Unknown action');
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    // log the failure class only — never the request body (personal data, passwords)
    console.error(`admin-users ${action}: unexpected error`, (e as Error)?.name ?? 'Error');
    return json(500, { error: 'Unexpected error' });
  }
}

async function createUser(api: Api, jwt: string, companyId: string, payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'payload is required');
  const p = { ...(payload as Record<string, unknown>) };
  delete p.password;                                           // passwords are never accepted from the browser

  const check = await api.rpcAsUser(jwt, 'user_create_check', { p_company_id: companyId, p_payload: p });
  if (check.error) dbError(check.error);
  const email: string = check.data.email;

  if (check.data.existing_user_id) {
    // The address already has a verified login (e.g. it works for another
    // company): give access, never touch its password.
    const done = await api.rpcAsUser(jwt, 'user_create_complete', {
      p_company_id: companyId, p_user_id: check.data.existing_user_id, p_payload: p, p_new_login: false });
    if (done.error) dbError(done.error);
    return { user_id: check.data.existing_user_id, email, existing_login: true, temporary_password: null };
  }

  const password = generatePassword();
  const created = await api.createUser({
    email, password, email_confirm: true,
    user_metadata: typeof p.full_name === 'string' ? { full_name: p.full_name } : {},
  });
  if (created.error || !created.data?.id) {
    throw new HttpError(409, /already|exists|registered/i.test(created.error?.message ?? '')
      ? `A login for ${email} already exists` : 'The login could not be created');
  }
  const userId: string = created.data.id;
  const done = await api.rpcAsUser(jwt, 'user_create_complete', {
    p_company_id: companyId, p_user_id: userId, p_payload: p, p_new_login: true });
  if (done.error) {
    await api.deleteUser(userId);                              // no half-created logins
    dbError(done.error);
  }
  return { user_id: userId, email, existing_login: false, temporary_password: password };
}

async function resetPassword(api: Api, jwt: string, companyId: string, userId: string) {
  const begin = await api.rpcAsUser(jwt, 'user_password_reset_begin', { p_company_id: companyId, p_user_id: userId });
  if (begin.error) dbError(begin.error);
  const password = generatePassword();
  const upd = await api.updateUser(userId, { password });
  if (upd.error) throw new HttpError(400, 'The password could not be reset');
  await api.rpcAsService('auth_revoke_sessions', { p_user_id: userId });
  return { user_id: userId, email: begin.data.email, temporary_password: password };
}

async function setStatus(api: Api, jwt: string, companyId: string, userId: string, active: boolean, reason: string | null) {
  const res = await api.rpcAsUser(jwt, 'user_set_status', {
    p_company_id: companyId, p_user_id: userId, p_active: active, p_reason: reason });
  if (res.error) dbError(res.error);
  const hasAccess = res.data?.has_access === true;
  // Ban the login only when it gives access to nothing any more; lift the
  // ban as soon as it gives access again.
  const upd = await api.updateUser(userId, { ban_duration: hasAccess ? 'none' : BAN_FOREVER });
  if (upd.error) throw new HttpError(400, 'Status saved, but the login could not be updated');
  if (!hasAccess) await api.rpcAsService('auth_revoke_sessions', { p_user_id: userId });
  return { user_id: userId, active, login_blocked: !hasAccess };
}
