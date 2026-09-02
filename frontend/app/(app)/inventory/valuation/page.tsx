'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { Scale, Boxes, PackageCheck } from 'lucide-react';

interface Row { id: number; sku: string; name: string; unit: string; currentStock: string; purchaseRate: string; value: string; isRawMaterial: boolean }

const TABS = [
  { key: '', label: 'All Stock' },
  { key: 'raw', label: 'Raw Material' },
  { key: 'finished', label: 'Finished Goods' },
];

export default function StockValuationPage() {
  const [stockType, setStockType] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['stock-valuation', stockType],
    queryFn: async () => (await api.get('/inventory/valuation', { params: { stockType: stockType || undefined } })).data,
  });

  const columns: Column<Row>[] = [
    { key: 'sku', header: 'SKU' },
    { key: 'name', header: 'Product' },
    { key: 'type', header: 'Type', render: (r) => <Badge status={r.isRawMaterial ? 'IN_PROGRESS' : 'ACTIVE'} label={r.isRawMaterial ? 'Raw Material' : 'Finished / Trading'} /> },
    { key: 'currentStock', header: 'Stock Qty', align: 'right', render: (r) => `${formatNumber(r.currentStock)} ${r.unit}` },
    { key: 'purchaseRate', header: 'Purchase Rate', align: 'right', render: (r) => formatCurrency(r.purchaseRate) },
    { key: 'value', header: 'Stock Value', align: 'right', render: (r) => formatCurrency(r.value) },
  ];

  return (
    <div>
      <PageHeader title="Stock Valuation" description="Current stock quantity × purchase rate, per product" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <StatCard label="Total Stock Value" value={formatCurrency(data?.meta?.totalValue ?? 0)} icon={Scale} tone="brand" />
        <StatCard label="Raw Material Value" value={formatCurrency(data?.meta?.rawMaterialValue ?? 0)} icon={Boxes} tone="warning" />
        <StatCard label="Finished Goods Value" value={formatCurrency(data?.meta?.finishedGoodsValue ?? 0)} icon={PackageCheck} tone="success" />
      </div>
      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t.key} className={stockType === t.key ? 'btn-primary' : 'btn-secondary'} onClick={() => setStockType(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />
    </div>
  );
}
