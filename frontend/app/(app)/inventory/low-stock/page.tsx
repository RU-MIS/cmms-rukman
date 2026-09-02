'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { formatNumber } from '@/lib/utils';

interface Product { id: number; sku: string; name: string; unit: { shortName: string }; currentStock: string; reorderLevel: string }

export default function LowStockPage() {
  const { data, isLoading } = useQuery({ queryKey: ['low-stock'], queryFn: async () => (await api.get('/inventory/low-stock')).data.data as Product[] });

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU' },
    { key: 'name', header: 'Product' },
    { key: 'currentStock', header: 'Current Stock', align: 'right', render: (p) => `${formatNumber(p.currentStock)} ${p.unit.shortName}` },
    { key: 'reorderLevel', header: 'Reorder Level', align: 'right', render: (p) => `${formatNumber(p.reorderLevel)} ${p.unit.shortName}` },
    { key: 'status', header: 'Status', render: () => <Badge status="LOW_STOCK" label="Reorder Needed" /> },
  ];

  return (
    <div>
      <PageHeader title="Low Stock" description="Products at or below their reorder level — plan a purchase or production run" />
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} emptyMessage="Nothing is low on stock right now." />
    </div>
  );
}
