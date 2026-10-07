'use client';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from './ui';

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider><SessionProvider>{children}</SessionProvider></ToastProvider>;
}
