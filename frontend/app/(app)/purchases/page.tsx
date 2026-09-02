'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { useDebouncedValue } from '@/lib/hooks';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Purchase { id: number; billNo: string; date: string; vendor: { name: string }; grandTotal: string; paidAmount: string; status: string }

export default function PurchasesListPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', debouncedSearch, page],
    queryFn: async () => (await api.get('/purchases', { params: { search: debouncedSearch, page, pageSize: 20 } })).data,
  });

  const columns: Column<Purchase>[] = [
    { key: 'billNo', header: 'Bill No' },
    { key: 'date', header: 'Date', render: (p) => formatDate(p.date) },
    { key: 'vendor', header: 'Vendor', render: (p) => p.vendor.name },
    { key: 'grandTotal', header: 'Total', align: 'right', render: (p) => formatCurrency(p.grandTotal) },
    { key: 'balance', header: 'Balance', align: 'right', render: (p) => formatCurrency(Number(p.grandTotal) - Number(p.paidAmount)) },
    { key: 'status', header: 'Status', render: (p) => <Badge status={p.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (p) => <button className="btn-ghost !px-2 !py-1" onClick={(e) => { e.stopPropagation(); openFile(`/documents/purchase/${p.id}`); }}><FileText size={14} /></button>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Purchase List"
        description="All confirmed and cancelled purchase bills"
        actions={
          <>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search bill / vendor…" />
            <button className="btn-primary" onClick={() => router.push('/purchases/new')}><Plus size={15} /> New Purchase</button>
          </>
        }
      />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} onRowClick={(p) => router.push(`/purchases/view?id=${p.id}`)} />
      {data?.meta && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPageChange={setPage} />}
    </div>
  );
}
