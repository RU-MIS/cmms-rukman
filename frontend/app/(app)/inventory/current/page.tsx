'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useDebouncedValue } from '@/lib/hooks';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { formatNumber } from '@/lib/utils';

interface Product { id: number; sku: string; name: string; unit: { shortName: string }; category?: { name: string }; currentStock: string; reorderLevel: string }

export default function CurrentStockPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['current-stock', debouncedSearch, page],
    queryFn: async () => (await api.get('/inventory/current', { params: { search: debouncedSearch, page, pageSize: 20 } })).data,
  });

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU' },
    { key: 'name', header: 'Product', render: (p) => <div><p className="font-medium">{p.name}</p>{p.category && <p className="text-xs text-ink-muted">{p.category.name}</p>}</div> },
    { key: 'currentStock', header: 'Current Stock', align: 'right', render: (p) => `${formatNumber(p.currentStock)} ${p.unit.shortName}` },
    { key: 'reorderLevel', header: 'Reorder Level', align: 'right', render: (p) => `${formatNumber(p.reorderLevel)} ${p.unit.shortName}` },
    { key: 'status', header: 'Status', render: (p) => (Number(p.currentStock) <= Number(p.reorderLevel) ? <Badge status="LOW_STOCK" label="Low Stock" /> : <Badge status="ACTIVE" label="OK" />) },
  ];

  return (
    <div>
      <PageHeader title="Current Stock" description="Live stock quantity for every product"
        actions={<SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search products…" />} />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />
      {data?.meta && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPageChange={setPage} />}
    </div>
  );
}
