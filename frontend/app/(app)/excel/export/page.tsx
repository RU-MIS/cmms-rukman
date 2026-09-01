'use client';

import { FileSpreadsheet } from 'lucide-react';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';

const EXPORTS = [
  { key: 'customers', label: 'Customers' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'products', label: 'Products' },
  { key: 'sales', label: 'Sales' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'payments', label: 'Payments' },
  { key: 'stock-ledger', label: 'Stock Ledger' },
  { key: 'production', label: 'Production' },
];

export default function ExcelExportPage() {
  return (
    <div>
      <PageHeader title="Excel Export" description="Download any module's data as a spreadsheet" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {EXPORTS.map((e) => (
          <button key={e.key} className="card p-4 flex items-center gap-3 hover:border-brand-300 text-left" onClick={() => openFile(`/excel/export/${e.key}`, `${e.key}.xlsx`)}>
            <div className="w-9 h-9 rounded-lg bg-success-bg text-success flex items-center justify-center shrink-0"><FileSpreadsheet size={17} /></div>
            <span className="text-sm font-medium text-ink">{e.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
