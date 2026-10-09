'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { brand, rpc } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useApplyBranding, useAssetUrl } from '@/lib/branding';
import { ErrorBox, Spinner } from './ui';
import { UserMenu } from './AppShell';

export interface PortalContext { company_id: string; company_name: string; kind: 'CUSTOMER' | 'VENDOR'; party_id: string; party_name: string;
  stock_visibility: string; rate_visible: boolean; quote_price_enabled: boolean; outstanding_visible: boolean;
  addresses: { id: string; code: string; name: string }[];
  /** portal permission codes of the login's portal role (portal_customer.* / portal_vendor.*) */
  features: string[] }

/** Portal tabs the login's portal role allows; the RPCs enforce the same features. */
export function portalTabs(ctx: PortalContext, tabs: { id: string; label: string; feature: string }[]) {
  const prefix = ctx.kind === 'CUSTOMER' ? 'portal_customer.' : 'portal_vendor.';
  return tabs.filter((t) => (ctx.features ?? []).includes(prefix + t.feature));
}

/** Portal pages: requires a signed-in portal user; all data comes from portal_* RPCs (own party only). */
export function PortalShell({ companyId, kind, children }: { companyId: string; kind: 'CUSTOMER' | 'VENDOR'; children: (ctx: PortalContext) => ReactNode }) {
  const { ready, session, boot } = useSession();
  const router = useRouter();
  const branding = boot?.portals.find((x) => x.company_id === companyId)?.branding;
  useApplyBranding(branding, kind === 'CUSTOMER' ? 'Customer portal' : 'Vendor portal');
  const logo = useAssetUrl(branding?.logo_path);
  useEffect(() => { if (ready && !session) router.replace('/login/'); }, [ready, session, router]);
  const ctx = useData(async () => (session && companyId ? rpc<PortalContext>('portal_context', { p_company_id: companyId, p_kind: kind }) : null), [session?.user.id, companyId, kind]);
  if (!ready || !session || (ctx.loading && !ctx.data)) return <Spinner />;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo && <img src={logo} alt="" data-testid="company-logo" className="h-8 w-auto" />}
            <div>
            <div className="font-semibold text-slate-800" data-testid="brand-name">{branding?.app_name || ctx.data?.company_name || brand.name}</div>
            <div className="text-xs text-slate-500">{kind === 'CUSTOMER' ? 'Customer portal' : 'Vendor portal'}{ctx.data ? ` · ${ctx.data.party_name}` : ''}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(boot?.portals.length ?? 0) > 1 && <Link className="text-sm text-brand" href="/portal/">Switch</Link>}
            {(boot?.companies.length ?? 0) > 0 && <Link className="text-sm text-brand" href="/erp/">ERP</Link>}
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-3 sm:p-5">
        {ctx.error ? <ErrorBox error={ctx.error} /> : ctx.data && children(ctx.data)}
      </main>
    </div>
  );
}
