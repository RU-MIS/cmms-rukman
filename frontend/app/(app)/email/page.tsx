'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Mail } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useDebouncedValue } from '@/lib/hooks';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { formatDate } from '@/lib/utils';

const EMAILABLE_TYPES = [
  { key: 'invoice', label: 'Sales Invoices', endpoint: '/sales', numberField: 'invoiceNo', party: (r: any) => r.customer },
  { key: 'purchase', label: 'Purchase Bills', endpoint: '/purchases', numberField: 'billNo', party: (r: any) => r.vendor },
  { key: 'payment-receipt', label: 'Payment Receipts', endpoint: '/payments', numberField: 'paymentNo', party: (r: any) => r.customer ?? r.vendor },
];

export default function EmailDocumentsPage() {
  const [tab, setTab] = useState(EMAILABLE_TYPES[0]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [target, setTarget] = useState<any>(null);
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['email-docs', tab.key, debouncedSearch],
    queryFn: async () => (await api.get(tab.endpoint, { params: { search: debouncedSearch, pageSize: 30 } })).data.data,
  });

  const columns: Column<any>[] = [
    { key: 'number', header: 'Document No', render: (r) => r[tab.numberField] },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'party', header: 'Party', render: (r) => tab.party(r)?.name },
    { key: 'actions', header: '', align: 'right', render: (r) => <button className="btn-secondary !py-1" onClick={() => { setTarget(r); setRecipient(tab.party(r)?.email ?? ''); }}><Mail size={14} /> Email</button> },
  ];

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await api.post('/email/send', { recipient, documentType: tab.key, documentId: target.id });
      toast.success('Email sent');
      setTarget(null);
      qc.invalidateQueries({ queryKey: ['email-logs'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <PageHeader title="Email Documents" description="Send invoices, purchase bills and payment receipts by email"
        actions={<SearchInput value={search} onChange={setSearch} placeholder="Search…" />} />
      <div className="flex flex-wrap gap-2 mb-4">
        {EMAILABLE_TYPES.map((t) => (
          <button key={t.key} className={tab.key === t.key ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(t)}>{t.label}</button>
        ))}
      </div>
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} />

      <Modal open={!!target} onClose={() => setTarget(null)} title="Send Email" width="max-w-sm">
        <form onSubmit={handleSend} className="space-y-3">
          <div><label className="label">Recipient Email *</label><input type="email" required className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button><button type="submit" disabled={sending} className="btn-primary">Send</button></div>
        </form>
      </Modal>
    </div>
  );
}
