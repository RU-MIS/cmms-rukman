'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { StatCard } from '@/components/ui/StatCard';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { Scale } from 'lucide-react';

interface Row { id: number; sku: string; name: string; unit: string; currentStock: string; purchaseRate: string; value: string }

export default function StockValuationPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['stock-valuation'],
    queryFn: async () => (await api.get('/inventory/valuation')).data,
  });

  const columns: Column<Row>[] = [
    { key: 'sku', header: 'SKU' },
    { key: 'name', header: 'Product' },
    { key: 'currentStock', header: 'Stock Qty', align: 'right', render: (r) => `${formatNumber(r.currentStock)} ${r.unit}` },
    { key: 'purchaseRate', header: 'Purchase Rate', align: 'right', render: (r) => formatCurrency(r.purchaseRate) },
    { key: 'value', header: 'Stock Value', align: 'right', render: (r) => formatCurrency(r.value) },
  ];

  return (
    <div>
      <PageHeader title="Stock Valuation" description="Current stock quantity × purchase rate, per product" />
      <div className="mb-4 max-w-xs">
        <StatCard label="Total Stock Value" value={formatCurrency(data?.meta?.totalValue ?? 0)} icon={Scale} tone="brand" />
      </div>
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />
    </div>
  );
}
