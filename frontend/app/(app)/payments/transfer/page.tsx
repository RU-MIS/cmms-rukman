'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowRightLeft } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Account { id: number; name: string; type: 'CASH' | 'BANK'; balance: string }
interface Transfer { id: number; transferNo: string; date: string; amount: string; remarks?: string; fromAccount: Account; toAccount: Account }

export default function FundTransferPage() {
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: async () => (await api.get('/accounts')).data.data as Account[] });
  const { data: transfers, isLoading } = useQuery({ queryKey: ['fund-transfers'], queryFn: async () => (await api.get('/accounts/transfers')).data.data as Transfer[] });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromAccountId || !toAccountId || !(Number(amount) > 0)) return toast.error('Fill all fields with a valid amount');
    if (fromAccountId === toAccountId) return toast.error('Source and destination account must differ');
    setSaving(true);
    try {
      await api.post('/accounts/transfer', { fromAccountId: Number(fromAccountId), toAccountId: Number(toAccountId), amount: Number(amount), remarks });
      toast.success('Fund transfer recorded');
      setFromAccountId(''); setToAccountId(''); setAmount(''); setRemarks('');
      qc.invalidateQueries({ queryKey: ['fund-transfers'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<Transfer>[] = [
    { key: 'transferNo', header: 'Transfer No' },
    { key: 'date', header: 'Date', render: (t) => formatDate(t.date) },
    { key: 'from', header: 'From', render: (t) => t.fromAccount.name },
    { key: 'to', header: 'To', render: (t) => t.toAccount.name },
    { key: 'amount', header: 'Amount', align: 'right', render: (t) => formatCurrency(t.amount) },
    { key: 'remarks', header: 'Remarks', render: (t) => t.remarks || '-' },
  ];

  return (
    <div>
      <PageHeader title="Fund Transfer" description="Move money between your cash and bank accounts — Cash↔Bank, or Bank↔Bank" />
      <form onSubmit={handleSubmit} className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-5 items-end">
        <div>
          <label className="label">From Account *</label>
          <select className="input" required value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
            <option value="">Select account</option>
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance)})</option>)}
          </select>
        </div>
        <div className="flex items-center justify-center text-ink-faint">
          <ArrowRightLeft size={18} />
        </div>
        <div>
          <label className="label">To Account *</label>
          <select className="input" required value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="">Select account</option>
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance)})</option>)}
          </select>
        </div>
        <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className="label">Remarks</label><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        <div className="md:col-span-5 flex justify-end"><button type="submit" disabled={saving} className="btn-primary">Transfer Funds</button></div>
      </form>

      <h2 className="text-sm font-semibold text-ink mb-2">Recent Transfers</h2>
      <DataTable columns={columns} rows={transfers ?? []} loading={isLoading} emptyMessage="No transfers yet" />
    </div>
  );
}
