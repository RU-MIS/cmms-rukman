'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function AppShell({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const mustChangePassword = useAuthStore((s) => s.user?.mustChangePassword);
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (hasHydrated && !token) router.replace('/login');
  }, [hasHydrated, token, router]);

  useEffect(() => {
    if (hasHydrated && token && mustChangePassword && typeof window !== 'undefined' && !window.location.pathname.startsWith('/account/change-password')) {
      router.replace('/account/change-password');
    }
  }, [hasHydrated, token, mustChangePassword, router]);

  if (!hasHydrated || !token) return null;

  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
