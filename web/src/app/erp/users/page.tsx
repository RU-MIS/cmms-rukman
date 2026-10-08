'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';

/** Moved to the User Management Center (old links keep working). */
export default function UsersRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/erp/admin/users/'); }, [router]);
  return <Spinner />;
}
