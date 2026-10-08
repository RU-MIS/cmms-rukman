'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/ui';

/** Sections of the Admin Control Center; each is shown only with its permission. */
const SECTIONS: { href: string; title: string; text: string; perm: string }[] = [
  { href: '/erp/admin/users/', title: 'Users', text: 'Internal, customer and vendor logins: create, temporary password, reset, disable, roles, overrides, godown access.', perm: 'users.view' },
  { href: '/erp/admin/roles/', title: 'Roles & permissions', text: 'Create, duplicate, disable roles; permission matrix; godown access per role.', perm: 'roles.view' },
  { href: '/erp/settings/', title: 'Company & settings', text: 'Company profile, portals, stock visibility, email, reminders, inventory rules.', perm: 'settings.view' },
  { href: '/erp/godowns/', title: 'Godowns & locations', text: 'Godowns, racks, shelves and bins.', perm: 'godowns.view' },
  { href: '/erp/items/', title: 'Items & packing', text: 'Item master, units and packing.', perm: 'items.view' },
  { href: '/erp/parties/', title: 'Customers & vendors', text: 'Customer and vendor master, portal access and visibility overrides.', perm: 'parties.view' },
];

export default function AdminCenter() {
  const { can } = useSession();
  const visible = SECTIONS.filter((s) => can(s.perm));
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
