'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronsLeft, ChevronsRight, Boxes } from 'lucide-react';
import { NAV } from './navConfig';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('bf-erp-sidebar-collapsed');
    if (stored) setCollapsed(stored === 'true');
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      localStorage.setItem('bf-erp-sidebar-collapsed', String(!prev));
      return !prev;
    });
  }

  return (
    <aside
      className={cn(
        'shrink-0 bg-sidebar text-white/90 flex flex-col h-screen sticky top-0 transition-all duration-200 border-r border-sidebar-border',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border shrink-0">
        <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center shrink-0">
          <Boxes size={16} className="text-white" />
        </div>
        {!collapsed && <span className="font-semibold text-sm tracking-wide truncate">BusinessFlow ERP</span>}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
        {NAV.map((group, gi) => (
          <div key={gi}>
            {group.label && !collapsed && (
              <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">{group.label}</p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                      active ? 'bg-sidebar-active text-white' : 'text-white/70 hover:bg-sidebar-hover hover:text-white'
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={toggle}
        className="flex items-center gap-2 px-4 h-11 border-t border-sidebar-border text-white/60 hover:text-white text-xs shrink-0"
      >
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
