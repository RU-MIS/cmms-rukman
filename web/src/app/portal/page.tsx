'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';
import { UserMenu } from '@/components/AppShell';

export default function PortalIndex() {
  const { ready, session, boot } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace('/login/');
    else if (boot?.portals.length === 1 && boot.companies.length === 0) {
      router.replace(`/portal/${boot.portals[0].kind.toLowerCase()}/?c=${boot.portals[0].company_id}`);
    }
  }, [ready, session, boot, router]);
  if (!ready || !boot) return <Spinner />;
  const portals = boot.portals;
  return (
    <div className="mx-auto max-w-lg p-6">
      <div className="mb-4 flex justify-end"><UserMenu /></div>
      <h1 className="mb-3 text-lg font-semibold">Choose a portal</h1>
      {portals.length === 0 && <p className="text-slate-600">Your email ({boot.email}) has no access yet. Ask the company to give you portal access, then sign in again.</p>}
      <ul className="space-y-2">{portals.map((p) => (
        <li key={`${p.company_id}-${p.kind}`}>
          <Link className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand" href={`/portal/${p.kind.toLowerCase()}/?c=${p.company_id}`}>
            <div className="font-medium">{p.company_name}</div>
            <div className="text-sm text-slate-500">{p.kind === 'CUSTOMER' ? 'Customer' : 'Vendor'} portal · {p.party_name}{!p.enabled && ' · currently turned off'}</div>
          </Link></li>))}</ul>
      {boot.companies.length > 0 && <Link className="mt-4 block text-brand" href="/erp/">Go to the ERP</Link>}
    </div>
  );
}
