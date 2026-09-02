'use client';

import { DateRangeReport } from '@/components/reports/DateRangeReport';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatNumber } from '@/lib/utils';

export default function ProductWiseReportPage() {
  const columns: Column<any>[] = [
    { key: 'product', header: 'Product' },
    { key: 'opening', header: 'Opening', align: 'right', render: (r) => formatNumber(r.opening) },
    { key: 'stockIn', header: 'Stock In', align: 'right', render: (r) => formatNumber(r.stockIn) },
    { key: 'stockOut', header: 'Stock Out', align: 'right', render: (r) => formatNumber(r.stockOut) },
    { key: 'production', header: 'Production', align: 'right', render: (r) => formatNumber(r.production) },
    { key: 'returns', header: 'Returns', align: 'right', render: (r) => formatNumber(r.returns) },
    { key: 'closing', header: 'Closing', align: 'right', render: (r) => <span className="font-medium">{formatNumber(r.closing)} {r.unit}</span> },
  ];

  return (
    <DateRangeReport title="Product-wise Report" description="Stock movement summary per product for the selected period" endpoint="/reports/product-wise" queryKey="report-product-wise">
      {(rows, loading) => <DataTable columns={columns} rows={rows} loading={loading} />}
    </DateRangeReport>
  );
}
