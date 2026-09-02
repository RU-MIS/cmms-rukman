'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Eye } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Account {
  id: number;
  name: string;
  type: 'CASH' | 'BANK';
  bankName?: string;
  accountNumber?: string;
  openingBalance: string;
  balance: string;
  active: boolean;
}

const emptyForm = { name: '', type: 'BANK', bankName: '', accountNumber: '', openingBalance: 0 };

export default function AccountsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<Account | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['accounts'], queryFn: async () => (await api.get('/accounts')).data.data as Account[] });
  const { data: ledger } = useQuery({
    queryKey: ['account-ledger', ledgerFor?.id],
    queryFn: async () => (await api.get(`/accounts/${ledgerFor!.id}/ledger`)).data.data,
    enabled: !!ledgerFor,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/accounts', form);
      toast.success('Account created');
      setModalOpen(false);
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<Account>[] = [
    { key: 'name', header: 'Account', render: (a) => <div><p className="font-medium">{a.name}</p>{a.bankName && <p className="text-xs text-ink-muted">{a.bankName}{a.accountNumber ? ` · ${a.accountNumber}` : ''}</p>}</div> },
    { key: 'type', header: 'Type', render: (a) => <Badge status={a.type === 'CASH' ? 'ACTIVE' : 'IN_PROGRESS'} label={a.type === 'CASH' ? 'Cash' : 'Bank'} /> },
    { key: 'balance', header: 'Current Balance', align: 'right', render: (a) => <span className="font-semibold">{formatCurrency(a.balance)}</span> },
    { key: 'actions', header: '', align: 'right', render: (a) => <button className="btn-ghost !px-2 !py-1" onClick={() => setLedgerFor(a)}><Eye size={14} /> Ledger</button> },
  ];

  return (
    <div>
      <PageHeader title="Accounts (Cash & Bank)" description="Track balances for cash-in-hand and each bank account"
        actions={<button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> New Account</button>} />
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Account" width="max-w-sm">
        <form onSubmit={handleCreate} className="space-y-3">
          <div><label className="label">Account Name *</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. HDFC Current A/c" /></div>
          <div>
            <label className="label">Type *</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
            </select>
          </div>
          {form.type === 'BANK' && (
            <>
              <div><label className="label">Bank Name</label><input className="input" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></div>
              <div><label className="label">Account Number</label><input className="input" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} /></div>
            </>
          )}
          <div><label className="label">Opening Balance</label><input type="number" step="0.01" className="input" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">Create Account</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!ledgerFor} onClose={() => setLedgerFor(null)} title={`${ledgerFor?.name ?? ''} — Ledger`} width="max-w-2xl">
        {ledger && (
          <div className="card overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr><th className="th">Date</th><th className="th">Type</th><th className="th">Ref</th><th className="th">Party</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th><th className="th text-right">Balance</th></tr>
              </thead>
              <tbody>
                {ledger.ledger.map((row: any, i: number) => (
                  <tr key={i}>
                    <td className="td">{formatDate(row.date)}</td>
                    <td className="td">{row.type}</td>
                    <td className="td">{row.reference}</td>
                    <td className="td">{row.party}</td>
                    <td className="td text-right">{Number(row.debit) ? formatCurrency(row.debit) : '-'}</td>
                    <td className="td text-right">{Number(row.credit) ? formatCurrency(row.credit) : '-'}</td>
                    <td className="td text-right font-medium">{formatCurrency(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
