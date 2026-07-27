'use client';
import { Menu, Bell, Search } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import Link from 'next/link';

interface TopbarProps { onMenuClick: () => void; title?: string; }

export default function Topbar({ onMenuClick, title }: TopbarProps) {
  const { user } = useAuthStore();
  return (
    <header className="h-16 bg-white border-b border-[#D4E4F7] flex items-center justify-between px-4 sm:px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        <button onClick={onMenuClick} className="lg:hidden p-2 text-[#7A9CC0] hover:text-[#0E2F76] hover:bg-[#F5FEFF] rounded-lg transition-colors" aria-label="Open menu">
          <Menu className="w-5 h-5" />
        </button>
        {title && <h1 className="text-base font-semibold text-[#0A1F4E] hidden sm:block">{title}</h1>}
      </div>
      <div className="flex items-center gap-2">
        <Link href="/notifications" className="p-2 text-[#7A9CC0] hover:text-[#0E2F76] hover:bg-[#F5FEFF] rounded-lg transition-colors relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </Link>
        <div className="flex items-center gap-2 pl-2 border-l border-[#D4E4F7]">
          <div className="w-8 h-8 bg-[#0E2F76] rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-bold">
              {user?.fullName.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() || 'U'}
            </span>
          </div>
          <div className="hidden sm:block">
            <div className="text-xs font-semibold text-[#0A1F4E]">{user?.fullName || 'User'}</div>
            <div className="text-xs text-[#7A9CC0]">{user?.deptName}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
