'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';

export default function Home() {
  const { ready, session, boot } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace('/login/');
    else if (boot && boot.companies.length > 0) router.replace('/erp/');
    else if (boot) router.replace('/portal/');
  }, [ready, session, boot, router]);
  return <Spinner />;
}
