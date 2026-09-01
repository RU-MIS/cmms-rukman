'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Payment { id: number; paymentNo: string; date: string; partyType: string; direction: string; amount: string; mode: string; customer?: { name: string }; vendor?: { name: string } }

export default function PaymentListPage() {
  const [page, setPage] = useState(1);
  const [partyType, setPartyType] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payments', page, partyType],
    queryFn: async () => (await api.get('/payments', { params: { page, pageSize: 20, partyType: partyType || undefined } })).data,
  });

  const columns: Column<Payment>[] = [
    { key: 'paymentNo', header: 'Payment No' },
    { key: 'date', header: 'Date', render: (p) => formatDate(p.date) },
    { key: 'party', header: 'Party', render: (p) => p.customer?.name ?? p.vendor?.name },
    { key: 'direction', header: 'Direction', render: (p) => (p.direction === 'RECEIVED' ? 'Received' : 'Paid') },
    { key: 'amount', header: 'Amount', align: 'right', render: (p) => formatCurrency(p.amount) },
    { key: 'mode', header: 'Mode' },
    { key: 'actions', header: '', align: 'right', render: (p) => <button className="btn-ghost !px-2 !py-1" onClick={() => openFile(`/documents/payment-receipt/${p.id}`)}><FileText size={14} /></button> },
  ];

  return (
    <div>
      <PageHeader
        title="Payment List"
        description="All customer and vendor payments"
        actions={
          <select className="input w-44" value={partyType} onChange={(e) => { setPartyType(e.target.value); setPage(1); }}>
            <option value="">All Parties</option>
            <option value="CUSTOMER">Customer</option>
            <option value="VENDOR">Vendor</option>
          </select>
        }
      />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />
      {data?.meta && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPageChange={setPage} />}
    </div>
  );
}
