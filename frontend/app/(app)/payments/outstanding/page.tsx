'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatCurrency } from '@/lib/utils';

export default function OutstandingPage() {
  const [tab, setTab] = useState<'customers' | 'vendors'>('customers');

  const { data, isLoading } = useQuery({
    queryKey: ['outstanding', tab],
    queryFn: async () => (await api.get(`/outstanding/${tab}`)).data.data,
  });

  const columns: Column<any>[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: tab === 'customers' ? 'Customer' : 'Vendor' },
    { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.outstanding)}</span> },
    { key: '0-30', header: '0–30 days', align: 'right', render: (r) => formatCurrency(r.ageing['0-30']) },
    { key: '31-60', header: '31–60 days', align: 'right', render: (r) => formatCurrency(r.ageing['31-60']) },
    { key: '61-90', header: '61–90 days', align: 'right', render: (r) => formatCurrency(r.ageing['61-90']) },
    { key: '90+', header: '90+ days', align: 'right', render: (r) => formatCurrency(r.ageing['90+']) },
  ];

  return (
    <div>
      <PageHeader title="Outstanding & Ageing" description="Who owes you, and who you owe — broken down by age" />
      <div className="flex gap-2 mb-4">
        <button className={tab === 'customers' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('customers')}>Receivable (Customers)</button>
        <button className={tab === 'vendors' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('vendors')}>Payable (Vendors)</button>
      </div>
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} emptyMessage="Nothing outstanding." />
    </div>
  );
}
