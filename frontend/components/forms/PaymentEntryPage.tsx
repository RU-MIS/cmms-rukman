'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FileText } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatCurrency, formatDate } from '@/lib/utils';

const MODES = ['CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER'];

export function PaymentEntryPage({ partyType }: { partyType: 'CUSTOMER' | 'VENDOR' }) {
  const isCustomer = partyType === 'CUSTOMER';
  const [partyId, setPartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [refNo, setRefNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: parties } = useQuery({
    queryKey: [isCustomer ? 'customers-all' : 'vendors-all'],
    queryFn: async () => (await api.get(isCustomer ? '/customers' : '/vendors', { params: { pageSize: 200 } })).data.data,
  });
  const { data: recent, isLoading } = useQuery({
    queryKey: ['payments-recent', partyType],
    queryFn: async () => (await api.get('/payments', { params: { partyType, pageSize: 15 } })).data.data,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId || !(Number(amount) > 0)) return toast.error(`Select a ${isCustomer ? 'customer' : 'vendor'} and enter a valid amount`);
    setSaving(true);
    try {
      await api.post('/payments', {
        partyType,
        [isCustomer ? 'customerId' : 'vendorId']: Number(partyId),
        amount: Number(amount),
        mode,
        refNo,
        remarks,
      });
      toast.success('Payment recorded — allocated to oldest outstanding invoices first');
      setPartyId(''); setAmount(''); setRefNo(''); setRemarks('');
      qc.invalidateQueries({ queryKey: ['payments-recent'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<any>[] = [
    { key: 'paymentNo', header: 'Payment No' },
    { key: 'date', header: 'Date', render: (p) => formatDate(p.date) },
    { key: 'party', header: isCustomer ? 'Customer' : 'Vendor', render: (p) => p.customer?.name ?? p.vendor?.name },
    { key: 'amount', header: 'Amount', align: 'right', render: (p) => formatCurrency(p.amount) },
    { key: 'mode', header: 'Mode' },
    { key: 'actions', header: '', align: 'right', render: (p) => <button className="btn-ghost !px-2 !py-1" onClick={() => openFile(`/documents/payment-receipt/${p.id}`)}><FileText size={14} /></button> },
  ];

  return (
    <div>
      <PageHeader title={isCustomer ? 'Customer Payment' : 'Vendor Payment'} description={isCustomer ? 'Record money received from a customer' : 'Record money paid to a vendor'} />
      <form onSubmit={handleSubmit} className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
        <div className="md:col-span-2">
          <label className="label">{isCustomer ? 'Customer' : 'Vendor'} *</label>
          <select className="input" required value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">Select {isCustomer ? 'customer' : 'vendor'}</option>
            {parties?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div>
          <label className="label">Mode *</label>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div><label className="label">Reference No.</label><input className="input" value={refNo} onChange={(e) => setRefNo(e.target.value)} /></div>
        <div className="md:col-span-5"><label className="label">Remarks</label><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        <div className="md:col-span-5 flex justify-end"><button type="submit" disabled={saving} className="btn-primary">Save Payment</button></div>
      </form>

      <h2 className="text-sm font-semibold text-ink mb-2">Recent {isCustomer ? 'Customer' : 'Vendor'} Payments</h2>
      <DataTable columns={columns} rows={recent ?? []} loading={isLoading} emptyMessage="No payments yet" />
    </div>
  );
}
