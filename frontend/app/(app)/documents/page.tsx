'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { useDebouncedValue } from '@/lib/hooks';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatDate } from '@/lib/utils';

const DOC_TYPES = [
  { key: 'sales', label: 'Sales Invoices', endpoint: '/sales', numberField: 'invoiceNo', partyField: (r: any) => r.customer.name, pdf: (id: number) => `/documents/invoice/${id}` },
  { key: 'purchases', label: 'Purchase Bills', endpoint: '/purchases', numberField: 'billNo', partyField: (r: any) => r.vendor.name, pdf: (id: number) => `/documents/purchase/${id}` },
  { key: 'sales-orders', label: 'Sales Orders', endpoint: '/sales-orders', numberField: 'orderNo', partyField: (r: any) => r.customer.name, pdf: (id: number) => `/documents/sales-order/${id}` },
  { key: 'purchase-orders', label: 'Purchase Orders', endpoint: '/purchase-orders', numberField: 'orderNo', partyField: (r: any) => r.vendor.name, pdf: (id: number) => `/documents/purchase-order/${id}` },
  { key: 'payments', label: 'Payment Receipts', endpoint: '/payments', numberField: 'paymentNo', partyField: (r: any) => r.customer?.name ?? r.vendor?.name, pdf: (id: number) => `/documents/payment-receipt/${id}` },
];

export default function DocumentsPage() {
  const [tab, setTab] = useState(DOC_TYPES[0]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', tab.key, debouncedSearch],
    queryFn: async () => (await api.get(tab.endpoint, { params: { search: debouncedSearch, pageSize: 30 } })).data.data,
  });

  const columns: Column<any>[] = [
    { key: 'number', header: 'Document No', render: (r) => r[tab.numberField] },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'party', header: 'Party', render: (r) => tab.partyField(r) },
    { key: 'actions', header: '', align: 'right', render: (r) => <button className="btn-secondary !py-1" onClick={() => openFile(tab.pdf(r.id))}><FileText size={14} /> View PDF</button> },
  ];

  return (
    <div>
      <PageHeader title="Documents" description="Generate and view PDF documents from real transaction data"
        actions={<SearchInput value={search} onChange={setSearch} placeholder="Search by number / party…" />} />
      <div className="flex flex-wrap gap-2 mb-4">
        {DOC_TYPES.map((t) => (
          <button key={t.key} className={tab.key === t.key ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(t)}>{t.label}</button>
        ))}
      </div>
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} />
    </div>
  );
}
