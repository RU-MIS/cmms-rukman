'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Browser Supabase client (anon key + the user's session). All security is enforced by RLS / RPCs. */
export function sb(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured');
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  return client;
}

export const brand = {
  name: process.env.NEXT_PUBLIC_APP_NAME ?? 'Rukman Dataflow Management System',
  short: process.env.NEXT_PUBLIC_APP_SHORT_NAME ?? 'Rukman DMS',
  color: process.env.NEXT_PUBLIC_PRIMARY_COLOR ?? '#1f4e79',
  logo: process.env.NEXT_PUBLIC_LOGO_URL || null,
};

/** Turns a PostgREST / Postgres error into the business message shown to the user. */
export function errorText(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const m = (e as { message?: string }).message ?? String(e);
  return m.replace(/^ERROR:\s*/, '');
}

/** Unwraps a Supabase response or throws its message. */
export function must<T>(res: { data: unknown; error: unknown }): T {
  if (res.error) throw new Error(errorText(res.error));
  return res.data as T;
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return must<T>(await sb().rpc(fn, args ?? {}));
}

/**
 * Money columns are not readable on the base tables (R3 field security). Rows
 * are read from the table (with its joins) and their values are added from the
 * masked `v_*` view: NULL where the user may not see them.
 */
export async function withValues<T extends { id: string }>(rows: T[], view: string, columns: string[], key = 'id'): Promise<T[]> {
  if (rows.length === 0) return rows;
  const vals = must<Record<string, unknown>[]>(await sb().from(view).select([key, ...columns].join(', ')).in(key, rows.map((r) => r.id)));
  const byId = new Map(vals.map((v) => [String(v[key]), v]));
  return rows.map((r) => ({ ...r, ...Object.fromEntries(columns.map((c) => [c, byId.get(r.id)?.[c] ?? null])) }));
}
