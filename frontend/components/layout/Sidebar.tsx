'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Wrench, Users, Building2, ClipboardCheck, Calendar, BarChart3, Bell, LogOut, X, Shield, ChevronRight, ShieldCheck, Settings } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

const ADMIN_ROLES = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];

const NAV = [
  { label: 'Dashboard',     href: '/dashboard',     icon: LayoutDashboard },
  { label: 'Machines',      href: '/machines',       icon: Wrench },
  { label: 'Employees',     href: '/employees',      icon: Users },
  { divider: true },
  { label: 'Checklists',    href: '/checklists',     icon: ClipboardCheck },
  { label: 'My Tasks',      href: '/tasks',          icon: Calendar },
  { label: 'Verify tasks',  href: '/verify',         icon: ShieldCheck, roles: ['Admin','MD','CEO','Production Head','Production Supervisor','Quality Head'] },
  { label: 'Reports',       href: '/reports',        icon: BarChart3, roles: ['Admin','MD','CEO','HR','MIS Executive','Quality Head','Production Head'] },
  { divider: true },
  { label: 'Departments',   href: '/departments',    icon: Building2, roles: ADMIN_ROLES },
  { label: 'Notifications', href: '/notifications',  icon: Bell },
] as const;

export default function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user, logout, isRole } = useAuthStore();

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onClose} />}
      <aside className={`fixed top-0 left-0 h-full z-50 bg-[#0E2F76] flex flex-col w-64 transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-4 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-base">CMMS Pro</div>
              <div className="text-white/50 text-xs">Rukman Udyog</div>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-white/60 hover:text-white p-1"><X className="w-5 h-5" /></button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {NAV.map((item: any, i) => {
            if (item.divider) return <div key={i} className="border-t border-white/10 my-3" />;
            if (item.roles && !isRole(item.roles)) return null;
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} onClick={onClose}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${active ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="flex-1">{item.label}</span>
                {active && <ChevronRight className="w-4 h-4 text-white/60" />}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          {user && (
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-bold">{user.fullName.split(' ').map((n:string) => n[0]).join('').slice(0,2).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white text-xs font-semibold truncate">{user.fullName}</div>
                <div className="text-white/50 text-xs">{user.roleName}</div>
              </div>
            </div>
          )}
          <button onClick={logout} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white transition-all">
            <LogOut className="w-5 h-5" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
