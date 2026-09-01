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

interface Sale {
  id: number;
  invoiceNo: string;
  date: string;
  customer: { name: string };
  grandTotal: string;
  paidAmount: string;
  status: string;
}

export default function SalesListPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['sales', debouncedSearch, page],
    queryFn: async () => (await api.get('/sales', { params: { search: debouncedSearch, page, pageSize: 20 } })).data,
  });

  const columns: Column<Sale>[] = [
    { key: 'invoiceNo', header: 'Invoice No' },
    { key: 'date', header: 'Date', render: (s) => formatDate(s.date) },
    { key: 'customer', header: 'Customer', render: (s) => s.customer.name },
    { key: 'grandTotal', header: 'Total', align: 'right', render: (s) => formatCurrency(s.grandTotal) },
    { key: 'balance', header: 'Balance', align: 'right', render: (s) => formatCurrency(Number(s.grandTotal) - Number(s.paidAmount)) },
    { key: 'status', header: 'Status', render: (s) => <Badge status={s.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (s) => (
        <button
          className="btn-ghost !px-2 !py-1"
          onClick={(e) => { e.stopPropagation(); openFile(`/documents/invoice/${s.id}`); }}
        >
          <FileText size={14} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sales List"
        description="All confirmed and cancelled sales invoices"
        actions={
          <>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search invoice / customer…" />
            <button className="btn-primary" onClick={() => router.push('/sales/new')}><Plus size={15} /> New Sale</button>
          </>
        }
      />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} onRowClick={(s) => router.push(`/sales/${s.id}`)} />
      {data?.meta && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPageChange={setPage} />}
    </div>
  );
}
