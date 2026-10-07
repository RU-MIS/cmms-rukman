'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { errorText, rpc, sb } from './supabase';

export interface CompanyAccess { id: string; name: string; code: string; roles: string[] }
export interface PortalAccess { company_id: string; company_name: string; kind: 'CUSTOMER' | 'VENDOR'; party_id: string; party_name: string; enabled: boolean }
export interface Bootstrap { user_id: string; email: string; full_name: string; companies: CompanyAccess[]; portals: PortalAccess[] }

interface SessionState {
  ready: boolean;
  session: Session | null;
  boot: Bootstrap | null;
  error: string | null;
  company: CompanyAccess | null;
  permissions: Set<string>;
  can: (perm: string) => boolean;
  setCompany: (id: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
const COMPANY_KEY = 'erp.company';

function storedCompany(): string | null {
  try { return localStorage.getItem(COMPANY_KEY); } catch { return null; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) { setBoot(null); setPermissions(new Set()); setReady(true); return; }
    try {
      const b = await rpc<Bootstrap>('session_bootstrap');
      setBoot(b);
      const wanted = storedCompany();
      const c = b.companies.find((x) => x.id === wanted) ?? b.companies[0] ?? null;
      setCompanyId(c?.id ?? null);
      if (c) setPermissions(new Set(await rpc<string[]>('my_permissions', { p_company_id: c.id })));
      setError(null);
    } catch (e) {
      const msg = errorText(e);
      // expired / revoked / forged session: sign out and go back to the login screen
      if (/jwt|token|not signed in|401|invalid claim|session/i.test(msg)) {
        await sb().auth.signOut({ scope: 'local' }).catch(() => undefined);
        setSession(null); setBoot(null); setPermissions(new Set());
        setError(null);
      } else {
        setError(msg);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const client = sb();
    client.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = client.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') load(s);
      else setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const value = useMemo<SessionState>(() => {
    const company = boot?.companies.find((c) => c.id === companyId) ?? null;
    return {
      ready, session, boot, error, company, permissions,
      can: (perm) => permissions.has(perm),
      setCompany: (id) => {
        try { localStorage.setItem(COMPANY_KEY, id); } catch { /* storage disabled */ }
        setCompanyId(id);
        rpc<string[]>('my_permissions', { p_company_id: id }).then((p) => setPermissions(new Set(p)));
      },
      refresh: async () => load((await sb().auth.getSession()).data.session),
      signOut: async () => { await sb().auth.signOut(); },
    };
  }, [ready, session, boot, error, companyId, permissions, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Company id of the active company (internal pages render only when it is set). */
export function useCompanyId(): string {
  const { company } = useSession();
  return company?.id ?? '';
}
