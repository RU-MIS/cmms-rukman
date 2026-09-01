'use client';

import { DateRangeReport } from '@/components/reports/DateRangeReport';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatCurrency } from '@/lib/utils';

export default function VendorWiseReportPage() {
  const columns: Column<any>[] = [
    { key: 'vendor', header: 'Vendor' },
    { key: 'purchases', header: 'Purchases', align: 'right', render: (r) => formatCurrency(r.purchases) },
    { key: 'payments', header: 'Payments', align: 'right', render: (r) => formatCurrency(r.payments) },
    { key: 'returns', header: 'Returns', align: 'right', render: (r) => formatCurrency(r.returns) },
    { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r) => <span className="font-medium">{formatCurrency(r.outstanding)}</span> },
  ];

  return (
    <DateRangeReport title="Vendor-wise Report" description="Purchases, payments, returns and outstanding per vendor" endpoint="/reports/vendor-wise" queryKey="report-vendor-wise">
      {(rows, loading) => <DataTable columns={columns} rows={rows} loading={loading} />}
    </DateRangeReport>
  );
}
