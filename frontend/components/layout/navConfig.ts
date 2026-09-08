import {
  LayoutDashboard, Users, Package, Tags, Ruler, Warehouse,
  BookOpen, ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine,
  SlidersHorizontal, AlertTriangle, Factory, ListChecks, Scale,
  Settings2, ShieldCheck, KeyRound, History, DatabaseBackup, LogOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavLeaf {
  label: string;
  href: string;
  icon: LucideIcon;
}
export interface NavGroup {
  label: string;
  items: NavLeaf[];
}

// NOTE: This app's scope is FMS (Flow Monitoring System), IMS (Inventory
// Monitoring System) and PMS (Production Monitoring System) only, plus a
// basic System Administration section. The legacy Sales/Purchase/Orders/
// Payments/Accounts/Documents/Email/Excel modules from the original
// BusinessFlow ERP are intentionally left out of this nav (kept dormant in
// code + DB, not deleted) rather than removed, since they were working
// functionality outside the current product scope. FMS pages, and the
// remaining PMS/IMS screens, are added here as each is actually built —
// this file should never link to a route that doesn't exist yet.
export const NAV: NavGroup[] = [
  {
    label: '',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Master Data',
    items: [
      { label: 'Products / Items', href: '/products', icon: Package },
      { label: 'Categories', href: '/categories', icon: Tags },
      { label: 'Units', href: '/units', icon: Ruler },
      { label: 'Warehouses / Locations', href: '/warehouses', icon: Warehouse },
    ],
  },
  {
    label: 'IMS — Inventory Monitoring',
    items: [
      { label: 'Current Stock', href: '/inventory/current', icon: Package },
      { label: 'Stock In', href: '/inventory/stock-in', icon: ArrowDownToLine },
      { label: 'Stock Out', href: '/inventory/stock-out', icon: ArrowUpFromLine },
      { label: 'Transfer', href: '/inventory/transfer', icon: ArrowLeftRight },
      { label: 'Adjustment', href: '/inventory/adjustment', icon: SlidersHorizontal },
      { label: 'Stock Ledger', href: '/inventory/ledger', icon: BookOpen },
      { label: 'Low Stock', href: '/inventory/low-stock', icon: AlertTriangle },
      { label: 'Valuation', href: '/inventory/valuation', icon: Scale },
    ],
  },
  {
    label: 'PMS — Production Monitoring',
    items: [
      { label: 'BOM', href: '/production/bom', icon: ListChecks },
      { label: 'Production Plans', href: '/production', icon: Factory },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', href: '/admin/users', icon: Users },
      { label: 'Roles & Permissions', href: '/admin/roles', icon: ShieldCheck },
      { label: 'Audit Logs', href: '/admin/audit-logs', icon: History },
      { label: 'Settings', href: '/admin/settings', icon: Settings2 },
      { label: 'Backup & Restore', href: '/admin/backup', icon: DatabaseBackup },
    ],
  },
];

export const LOGOUT_ICON = LogOut;
export const KEY_ICON = KeyRound;
