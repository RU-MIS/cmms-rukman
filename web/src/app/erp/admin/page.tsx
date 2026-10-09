'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { IMPORT_EXPORT_PERMS, SETTINGS_VIEW_PERMS } from '@/components/AppShell';

/** Sections of the Admin Control Center; each is shown only with its permission. */
const SECTIONS: { href: string; title: string; text: string; perm: string | string[] }[] = [
  { href: '/erp/admin/users/', title: 'Users', text: 'Internal, customer and vendor logins: create, temporary password, reset, disable, roles, overrides, data access.', perm: 'users.view' },
  { href: '/erp/admin/departments/', title: 'Departments', text: 'Departments of the users (record scope "My department").', perm: 'users.view' },
  { href: '/erp/admin/roles/', title: 'Roles & permissions', text: 'Create, duplicate, disable roles; permission matrix; data and record scopes per role.', perm: 'roles.view' },
  { href: '/erp/admin/settings/', title: 'Settings', text: 'Company profile, branding, inventory, sales, purchase, documents, portals, email, reminders, approvals, security.', perm: SETTINGS_VIEW_PERMS },
  { href: '/erp/admin/modules/', title: 'Modules', text: 'Switch business modules on or off for the company.', perm: 'settings_modules.view' },
  { href: '/erp/admin/numbering/', title: 'Numbering', text: 'Document and master code numbering: prefix, pattern, padding, start number, reset.', perm: 'settings_numbering.view' },
  { href: '/erp/admin/approval-rules/', title: 'Approval rules', text: 'Approval levels per document type, approver roles, amount thresholds, self-approval.', perm: 'settings_approvals.view' },
  { href: '/erp/admin/security/', title: 'Security & logins', text: 'Password policy, temporary passwords, idle sign-out, login overview.', perm: 'settings_security.view' },
  { href: '/erp/admin/audit/', title: 'Audit log', text: 'Who changed what and when, with old / new values; export.', perm: 'audit.view' },
  { href: '/erp/admin/godowns/', title: 'Godowns', text: 'Manager, default godown, receipts / dispatch / transfers, assigned users.', perm: 'godowns.view' },
  { href: '/erp/admin/items/', title: 'Items', text: 'Item master: packing, rates, rate limits, images, documents, stock, custom fields.', perm: 'items.view' },
  { href: '/erp/admin/customers/', title: 'Customers', text: 'Customer master, type, status, addresses, rates, opening balance, documents, logins.', perm: 'customers.view' },
  { href: '/erp/admin/vendors/', title: 'Vendors', text: 'Vendor master, type, status, purchase rates, opening balance, documents, logins.', perm: 'vendors.view' },
  { href: '/erp/admin/import-export/', title: 'Import / Export', text: 'Excel templates, column mapping, validated imports and permission-filtered exports.', perm: IMPORT_EXPORT_PERMS },
  { href: '/erp/admin/custom-fields/', title: 'Custom fields', text: 'Extra fields for items, customers, vendors, users, godowns, orders and documents.', perm: 'settings_custom_fields.view' },
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
