'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, LogOut, KeyRound, AlertTriangle, Building2, Plus, Check, Menu } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { api, apiErrorMessage } from '@/lib/api';
import { GlobalSearch } from './GlobalSearch';
import Link from 'next/link';

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const companies = useAuthStore((s) => s.companies);
  const setActiveCompany = useAuthStore((s) => s.setActiveCompany);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const companyMenuRef = useRef<HTMLDivElement>(null);

  async function handleSwitchCompany(companyId: number) {
    if (companyId === activeCompany?.id) return setCompanyMenuOpen(false);
    setSwitching(true);
    try {
      const res = await api.post('/auth/switch-company', { companyId });
      setActiveCompany(res.data.data.token, res.data.data.activeCompany);
      // Full reload: react-query caches aren't keyed by company, so a hard
      // navigation is the simplest way to guarantee no stale cross-company data.
      window.location.href = '/dashboard';
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setSwitching(false);
    }
  }

  const { data: lowStock } = useQuery({
    queryKey: ['low-stock-notifications'],
    queryFn: async () => (await api.get('/inventory/low-stock')).data.data,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (companyMenuRef.current && !companyMenuRef.current.contains(e.target as Node)) setCompanyMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const alertCount = lowStock?.length ?? 0;

  return (
    <header className="h-14 sticky top-0 z-30 bg-white border-b border-card-border flex items-center justify-between px-3 md:px-4 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onMenuClick} className="lg:hidden -ml-1 w-9 h-9 rounded-full flex items-center justify-center text-ink-muted hover:bg-brand-50 shrink-0">
          <Menu size={19} />
        </button>
        <span className="lg:hidden font-semibold text-sm text-ink shrink-0">BusinessFlow ERP</span>
        <div className="min-w-0 hidden lg:block">
          <p className="text-sm font-medium text-ink truncate">
            {greeting}, {user?.name ?? ''}
          </p>
          <p className="text-[11px] text-ink-muted -mt-0.5 truncate">Here's what's happening with your business today.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="hidden lg:block">
          <GlobalSearch />
        </div>

        <div className="relative" ref={companyMenuRef}>
          <button
            onClick={() => setCompanyMenuOpen((v) => !v)}
            disabled={switching}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium text-ink hover:bg-brand-50 border border-card-border"
          >
            <Building2 size={14} className="text-brand-600" />
            <span className="hidden sm:inline max-w-[140px] truncate">{activeCompany?.name ?? 'Select company'}</span>
            <ChevronDown size={13} className="text-ink-muted" />
          </button>
          {companyMenuOpen && (
            <div className="absolute right-0 mt-1 w-64 card p-1 z-40">
              <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Your companies</p>
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSwitchCompany(c.id)}
                  className="flex items-center gap-2 w-full px-2.5 py-2 text-sm rounded hover:bg-brand-50 text-ink text-left"
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] text-ink-faint">{c.role}</span>
                  {c.id === activeCompany?.id && <Check size={13} className="text-brand-600 shrink-0" />}
                </button>
              ))}
              <div className="border-t border-card-border mt-1 pt-1">
                <Link
                  href="/companies"
                  onClick={() => setCompanyMenuOpen(false)}
                  className="flex items-center gap-2 px-2.5 py-2 text-sm rounded hover:bg-brand-50 text-brand-600"
                >
                  <Plus size={14} /> Create New Company
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative w-9 h-9 rounded-full flex items-center justify-center text-ink-muted hover:bg-brand-50"
          >
            <Bell size={17} />
            {alertCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-danger text-white text-[9px] flex items-center justify-center">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 mt-1 w-72 card p-2 z-40">
              <p className="px-1.5 py-1 text-xs font-semibold text-ink">Low stock alerts</p>
              {alertCount === 0 && <p className="px-1.5 py-2 text-xs text-ink-faint">No low stock alerts right now.</p>}
              <div className="max-h-64 overflow-y-auto">
                {lowStock?.slice(0, 8).map((p: any) => (
                  <Link
                    key={p.id}
                    href="/inventory/low-stock"
                    onClick={() => setNotifOpen(false)}
                    className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-warning-bg text-xs"
                  >
                    <AlertTriangle size={13} className="text-warning shrink-0" />
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-ink-faint shrink-0">{p.currentStock} left</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-brand-50">
            <div className="w-8 h-8 rounded-full bg-brand-600 text-white text-xs font-semibold flex items-center justify-center">
              {(user?.name ?? '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-medium text-ink leading-tight">{user?.name}</p>
              <p className="text-[10px] text-ink-muted leading-tight">{activeCompany?.role}</p>
            </div>
            <ChevronDown size={14} className="text-ink-muted" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-48 card p-1 z-40">
              <Link
                href="/account/change-password"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-2.5 py-2 text-sm rounded hover:bg-brand-50 text-ink"
              >
                <KeyRound size={14} /> Change Password
              </Link>
              <button
                onClick={() => {
                  logout();
                  router.replace('/login');
                }}
                className="flex items-center gap-2 w-full px-2.5 py-2 text-sm rounded hover:bg-danger-bg text-danger"
              >
                <LogOut size={14} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
