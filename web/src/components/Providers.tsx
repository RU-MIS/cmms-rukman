'use client';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from './ui';
import { PasswordGate } from './PasswordGate';

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider><SessionProvider><PasswordGate>{children}</PasswordGate></SessionProvider></ToastProvider>;
}
