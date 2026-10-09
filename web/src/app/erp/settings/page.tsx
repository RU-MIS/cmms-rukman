'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';

/** The settings moved to Admin → Settings (one section per right); old links keep working. */
export default function SettingsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/erp/admin/settings/'); }, [router]);
  return <Spinner />;
}
