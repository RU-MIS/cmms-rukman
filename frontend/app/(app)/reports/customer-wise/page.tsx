'use client';

import { DateRangeReport } from '@/components/reports/DateRangeReport';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatCurrency } from '@/lib/utils';

export default function CustomerWiseReportPage() {
  const columns: Column<any>[] = [
    { key: 'customer', header: 'Customer' },
    { key: 'sales', header: 'Sales', align: 'right', render: (r) => formatCurrency(r.sales) },
    { key: 'payments', header: 'Payments', align: 'right', render: (r) => formatCurrency(r.payments) },
    { key: 'returns', header: 'Returns', align: 'right', render: (r) => formatCurrency(r.returns) },
    { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r) => <span className="font-medium">{formatCurrency(r.outstanding)}</span> },
  ];

  return (
    <DateRangeReport title="Customer-wise Report" description="Sales, payments, returns and outstanding per customer" endpoint="/reports/customer-wise" queryKey="report-customer-wise">
      {(rows, loading) => <DataTable columns={columns} rows={rows} loading={loading} />}
    </DateRangeReport>
  );
}
