'use client';

import { DateRangeReport } from '@/components/reports/DateRangeReport';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';

export default function DateWiseSummaryPage() {
  const columns: Column<any>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'sales', header: 'Sales', align: 'right', render: (r) => formatCurrency(r.sales) },
    { key: 'purchase', header: 'Purchase', align: 'right', render: (r) => formatCurrency(r.purchase) },
    { key: 'collection', header: 'Collection', align: 'right', render: (r) => formatCurrency(r.collection) },
    { key: 'payment', header: 'Payment', align: 'right', render: (r) => formatCurrency(r.payment) },
    { key: 'stockIn', header: 'Stock In', align: 'right', render: (r) => formatNumber(r.stockIn) },
    { key: 'stockOut', header: 'Stock Out', align: 'right', render: (r) => formatNumber(r.stockOut) },
    { key: 'production', header: 'Production', align: 'right', render: (r) => formatNumber(r.production) },
    { key: 'expenses', header: 'Expenses', align: 'right', render: (r) => formatCurrency(r.expenses) },
    { key: 'netSales', header: 'Net Sales', align: 'right', render: (r) => formatCurrency(r.netSales) },
  ];

  return (
    <DateRangeReport title="Date-wise Summary" description="Daily business activity across every module" endpoint="/reports/date-wise" queryKey="report-date-wise">
      {(rows, loading) => <DataTable columns={columns} rows={rows} loading={loading} keyField="date" />}
    </DateRangeReport>
  );
}
