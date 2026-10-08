'use client';
import { sb } from './supabase';

/** Row of the User Management Center (admin_users RPC). */
export interface AdminUser {
  key: string;
  user_id: string | null;
  portal_user_id?: string;
  kind: 'INTERNAL' | 'CUSTOMER' | 'VENDOR';
  email: string;
  full_name: string;
  mobile?: string | null;
  department?: string | null;
  designation?: string | null;
  employee_code?: string | null;
  party_id?: string;
  party_name?: string;
  status: 'ACTIVE' | 'DISABLED';
  claimed?: boolean;
  must_change_password: boolean;
  last_sign_in_at: string | null;
  created_at: string;
  is_owner: boolean;
  roles: { id: string; code: string; name: string }[];
  godown_ids?: string[] | null;
  override_count?: number;
}

export interface Role {
  id: string; code: string; name: string; description: string; kind: string;
  is_active: boolean; is_locked: boolean; grants_all: boolean; is_system: boolean; sort_order: number;
}
export interface Permission { code: string; module: string; action: string; label: string | null; description: string; kind: string; sort_order: number; is_sensitive: boolean }
export interface PermissionModule { module: string; label: string; group_label: string; sort_order: number }

/**
 * Calls the admin-users Edge Function (create login, reset password,
 * enable / disable). The user's own session token is sent; the function and
 * the database decide what is allowed. Temporary passwords come back once and
 * are never stored by the app.
 */
export async function adminUsers<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { msg = (await ctx.json()).error ?? msg; } catch { /* not json */ }
    }
    throw new Error(msg);
  }
  return data as T;
}
