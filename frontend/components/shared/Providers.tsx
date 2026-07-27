'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:          60 * 1000, // 1 minute
      retry:              1,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const setHydrated = useAuthStore(s => s.setHydrated);

  useEffect(() => {
    setMounted(true);
    setHydrated();
  }, [setHydrated]);

  if (!mounted) {
    // Prevent hydration mismatch
    return <div className="min-h-screen bg-surface-app" />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
