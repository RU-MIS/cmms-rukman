'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/ui';

/** Sections of the Admin Control Center; each is shown only with its permission. */
const SECTIONS: { href: string; title: string; text: string; perm: string | string[] }[] = [
  { href: '/erp/admin/users/', title: 'Users', text: 'Internal, customer and vendor logins: create, temporary password, reset, disable, roles, overrides, godown access.', perm: 'users.view' },
  { href: '/erp/admin/roles/', title: 'Roles & permissions', text: 'Create, duplicate, disable roles; permission matrix; godown access per role.', perm: 'roles.view' },
  { href: '/erp/settings/', title: 'Company & settings', text: 'Company profile, portals, stock visibility, email, reminders, inventory rules.', perm: 'settings.view' },
  { href: '/erp/godowns/', title: 'Godowns & locations', text: 'Godowns, racks, shelves and bins.', perm: 'godowns.view' },
  { href: '/erp/admin/items/', title: 'Items', text: 'Item master: packing, barcode, SKU, rates and rate history, customer / vendor rates, images, custom fields.', perm: 'items.view' },
  { href: '/erp/admin/customers/', title: 'Customers', text: 'Customer master, addresses, special rates, credit, portal visibility and customer logins.', perm: 'parties.view' },
  { href: '/erp/admin/vendors/', title: 'Vendors', text: 'Vendor master, purchase rates, portal visibility and vendor logins.', perm: 'parties.view' },
  { href: '/erp/admin/import-export/', title: 'Import / Export', text: 'Excel templates, validated imports (all-or-nothing by default) and permission-filtered exports.',
    perm: ['items.import', 'items.export', 'parties.import', 'parties.export', 'godowns.import', 'godowns.export', 'rates.import', 'rates.export', 'stock_adjustment.import', 'users.import', 'users.export'] },
  { href: '/erp/admin/custom-fields/', title: 'Custom fields', text: 'Extra fields for items, customers and vendors.', perm: 'settings.view' },
];

export default function AdminCenter() {
  const { can } = useSession();
  const visible = SECTIONS.filter((s) => (Array.isArray(s.perm) ? s.perm : [s.perm]).some((p) => can(p)));
  return (
    <div>
      <PageHeader title="Admin control center" subtitle="Business configuration without code changes." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((s) => (
          <Link key={s.href} href={s.href} className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand">
            <div className="font-semibold text-slate-800">{s.title}</div>
            <div className="mt-1 text-sm text-slate-500">{s.text}</div>
          </Link>))}
      </div>
    </div>
  );
}
