'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { brand } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Spinner } from './ui';

/** Menu = data; an entry is shown when the user holds one of its permissions. */
export const NAV: { href: string; label: string; perm?: string | string[]; group: string }[] = [
  { href: '/erp/', label: 'Dashboard', group: 'Overview' },
  { href: '/erp/inventory/', label: 'Inventory', perm: 'items.view', group: 'Inventory' },
  { href: '/erp/items/', label: 'Items & packing', perm: 'items.view', group: 'Inventory' },
  { href: '/erp/godowns/', label: 'Godowns & locations', perm: 'godowns.view', group: 'Inventory' },
  { href: '/erp/stock/', label: 'Stock in / out / transfer', perm: 'stock_transfer.view', group: 'Inventory' },
  { href: '/erp/customer-pos/', label: 'Customer POs', perm: 'customer_po.view', group: 'Sales' },
  { href: '/erp/sales-orders/', label: 'Sales orders & dispatch', perm: 'sales_order.view', group: 'Sales' },
  { href: '/erp/purchase-orders/', label: 'Purchase orders', perm: 'purchase_order.view', group: 'Purchase' },
  { href: '/erp/receiving/', label: 'Receiving', perm: 'purchase_receipt.view', group: 'Purchase' },
  { href: '/erp/bills/', label: 'Invoices & bills', perm: 'customer_bill.view', group: 'Accounts' },
  { href: '/erp/payments/', label: 'Payments', perm: 'voucher.view', group: 'Accounts' },
  { href: '/erp/reminders/', label: 'Payment reminders', perm: 'voucher.view', group: 'Accounts' },
  { href: '/erp/documents/', label: 'Documents', perm: 'documents.view', group: 'Documents' },
  { href: '/erp/email-log/', label: 'Email log', perm: 'email.view', group: 'Documents' },
  { href: '/erp/admin/customers/', label: 'Customers', perm: 'parties.view', group: 'Masters' },
  { href: '/erp/admin/vendors/', label: 'Vendors', perm: 'parties.view', group: 'Masters' },
  { href: '/erp/parties/', label: 'Customers & vendors', perm: 'parties.view', group: 'Masters' },
  { href: '/erp/admin/import-export/', label: 'Import / Export', perm: ['items.import', 'items.export', 'parties.import', 'parties.export', 'godowns.import', 'godowns.export', 'rates.import', 'rates.export', 'stock_adjustment.import', 'users.import', 'users.export'], group: 'Masters' },
  { href: '/erp/admin/', label: 'Admin control center', perm: ['users.view', 'roles.view', 'settings.view'], group: 'Admin' },
  { href: '/erp/admin/users/', label: 'Users', perm: 'users.view', group: 'Admin' },
  { href: '/erp/admin/roles/', label: 'Roles & permissions', perm: 'roles.view', group: 'Admin' },
  { href: '/erp/admin/custom-fields/', label: 'Custom fields', perm: 'settings.view', group: 'Admin' },
  { href: '/erp/settings/', label: 'Settings', perm: 'settings.view', group: 'Admin' },
];

/** Pages outside the menu that still need a permission (direct URL access). */
const EXTRA_ROUTES: { href: string; perm: string | string[] }[] = [
  { href: '/erp/item/', perm: 'items.view' },
  { href: '/erp/admin/items/', perm: 'items.view' },
  { href: '/erp/users/', perm: 'users.view' },
];

const allowed = (perm: string | string[] | undefined, can: (p: string) => boolean) =>
  !perm || (Array.isArray(perm) ? perm.some(can) : can(perm));

/** Permission needed for a path: most specific menu / route entry. */
export function routePermission(path: string): string | string[] | undefined {
  const p = path.endsWith('/') ? path : `${path}/`;
  const match = [...NAV, ...EXTRA_ROUTES].filter((n) => n.href !== '/erp/' && p.startsWith(n.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.perm;
}

export function UserMenu() {
  const { boot, signOut } = useSession();
  const router = useRouter();
  return (
    <div className="flex items-center gap-3 text-sm">
      <Link href="/account/" className="hidden text-slate-600 hover:text-brand sm:inline">{boot?.email}</Link>
      <button className="rounded-md border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-50"
        onClick={async () => { await signOut(); router.replace('/login/'); }}>Logout</button>
    </div>
  );
}

/** Internal ERP layout: requires a signed-in company member. */
export function AppShell({ children }: { children: ReactNode }) {
  const { ready, session, boot, company, can, setCompany, error } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace(`/login/?next=${encodeURIComponent(path)}`);
    else if (boot && boot.companies.length === 0) router.replace('/portal/');
  }, [ready, session, boot, router, path]);

  if (!ready || !session || !boot || !company) {
    return error ? (
      <div className="space-y-3 p-6">
        <div role="alert" className="text-red-600">{error}</div>
        <UserMenu />
      </div>
    ) : <Spinner />;
  }
  const items = NAV.filter((n) => allowed(n.perm, can));
  // direct URL access: the page is not rendered without its permission (the
  // database refuses the data anyway)
  const pageAllowed = allowed(routePermission(path), can);
  const groups = [...new Set(items.map((n) => n.group))];

  return (
    <div className="flex min-h-screen">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform overflow-y-auto bg-slate-900 text-slate-200 transition lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="border-b border-slate-800 px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brand.logo && <img src={brand.logo} alt="" className="mb-2 h-8 w-auto" />}
          <div className="text-base font-semibold text-white">{brand.short}</div>
          {boot.companies.length > 1 ? (
            <select aria-label="Company" value={company.id} onChange={(e) => setCompany(e.target.value)}
              className="mt-2 w-full rounded bg-slate-800 px-2 py-1 text-sm text-white">
              {boot.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : <div className="mt-1 text-xs text-slate-400">{company.name}</div>}
        </div>
        <nav className="px-2 py-3" aria-label="Main">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g}</div>
              {items.filter((n) => n.group === g).map((n) => {
                const active = n.href === '/erp/' ? path === '/erp/' || path === '/erp' : path.startsWith(n.href.replace(/\/$/, ''));
                return (
                  <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                    className={`block rounded-md px-2 py-1.5 text-sm ${active ? 'bg-brand text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                    {n.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Menu" onClick={() => setOpen(true)}>☰</button>
          <div className="truncate text-sm text-slate-500">{brand.name}</div>
          <UserMenu />
        </header>
        <main className="min-w-0 flex-1 p-3 sm:p-5">{pageAllowed ? children : (
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-800">
            You do not have access to this page. Ask your administrator for the permission.
          </div>)}</main>
      </div>
    </div>
  );
}
