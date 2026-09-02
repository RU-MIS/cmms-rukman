import {
  LayoutDashboard, Users, Truck, Package, Tags, Ruler, Warehouse,
  ShoppingCart, List, RotateCcw, BookOpen, BarChart3,
  ClipboardList, PackageCheck, ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine,
  SlidersHorizontal, AlertTriangle, Factory, ListChecks, Wallet,
  Receipt, HandCoins, Scale, FileText, Mail, MailCheck, Settings2,
  ShieldCheck, KeyRound, History, DatabaseBackup, LogOut, Landmark,
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

export const NAV: NavGroup[] = [
  {
    label: '',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Master Data',
    items: [
      { label: 'Customers', href: '/customers', icon: Users },
      { label: 'Vendors', href: '/vendors', icon: Truck },
      { label: 'Products', href: '/products', icon: Package },
      { label: 'Categories', href: '/categories', icon: Tags },
      { label: 'Units', href: '/units', icon: Ruler },
      { label: 'Warehouses', href: '/warehouses', icon: Warehouse },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Sale Entry', href: '/sales/new', icon: ShoppingCart },
      { label: 'Sales List', href: '/sales', icon: List },
      { label: 'Sales Returns', href: '/sales/returns', icon: RotateCcw },
      { label: 'Sales Ledger', href: '/sales/ledger', icon: BookOpen },
    ],
  },
  {
    label: 'Purchase',
    items: [
      { label: 'Purchase Entry', href: '/purchases/new', icon: ShoppingCart },
      { label: 'Purchase List', href: '/purchases', icon: List },
      { label: 'Purchase Returns', href: '/purchases/returns', icon: RotateCcw },
      { label: 'Purchase Ledger', href: '/purchases/ledger', icon: BookOpen },
    ],
  },
  {
    label: 'Orders',
    items: [
      { label: 'Sales Orders', href: '/orders/sales', icon: ClipboardList },
      { label: 'Purchase Orders', href: '/orders/purchase', icon: PackageCheck },
      { label: 'Pending Tracking', href: '/orders/pending', icon: AlertTriangle },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Current Stock', href: '/inventory/current', icon: Package },
      { label: 'Stock In', href: '/inventory/stock-in', icon: ArrowDownToLine },
      { label: 'Stock Out', href: '/inventory/stock-out', icon: ArrowUpFromLine },
      { label: 'Adjustment', href: '/inventory/adjustment', icon: SlidersHorizontal },
      { label: 'Transfer', href: '/inventory/transfer', icon: ArrowLeftRight },
      { label: 'Stock Ledger', href: '/inventory/ledger', icon: BookOpen },
      { label: 'Low Stock', href: '/inventory/low-stock', icon: AlertTriangle },
      { label: 'Valuation', href: '/inventory/valuation', icon: Scale },
    ],
  },
  {
    label: 'Production',
    items: [
      { label: 'BOM', href: '/production/bom', icon: ListChecks },
      { label: 'Production Plans', href: '/production', icon: Factory },
    ],
  },
  {
    label: 'Payments',
    items: [
      { label: 'Customer Payment', href: '/payments/customer', icon: HandCoins },
      { label: 'Vendor Payment', href: '/payments/vendor', icon: Wallet },
      { label: 'Payment List', href: '/payments', icon: Receipt },
      { label: 'Fund Transfer', href: '/payments/transfer', icon: ArrowLeftRight },
      { label: 'Accounts (Cash/Bank)', href: '/payments/accounts', icon: Landmark },
      { label: 'Outstanding', href: '/payments/outstanding', icon: Scale },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Date-wise Summary', href: '/reports/date-wise', icon: BarChart3 },
      { label: 'Customer-wise', href: '/reports/customer-wise', icon: BarChart3 },
      { label: 'Vendor-wise', href: '/reports/vendor-wise', icon: BarChart3 },
      { label: 'Product-wise', href: '/reports/product-wise', icon: BarChart3 },
    ],
  },
  {
    label: 'Documents',
    items: [
      { label: 'PDF Documents', href: '/documents', icon: FileText },
      { label: 'Email Documents', href: '/email', icon: Mail },
      { label: 'Email Logs', href: '/email/logs', icon: MailCheck },
    ],
  },
  {
    label: 'Excel',
    items: [
      { label: 'Import', href: '/excel/import', icon: ArrowDownToLine },
      { label: 'Export', href: '/excel/export', icon: ArrowUpFromLine },
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
