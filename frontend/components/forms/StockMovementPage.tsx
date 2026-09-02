'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatDate, formatNumber } from '@/lib/utils';

interface Props {
  title: string;
  description: string;
  endpoint: string;
  txnType: string;
  showRate?: boolean;
  allowNegativeLabel?: boolean;
}

export function StockMovementPage({ title, description, endpoint, txnType, showRate }: Props) {
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data });
  const { data: recent, isLoading } = useQuery({
    queryKey: ['stock-ledger-recent', txnType],
    queryFn: async () => (await api.get('/inventory/ledger', { params: { pageSize: 15 } })).data.data.filter((t: any) => t.type === txnType),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !(Number(qty) !== 0)) return toast.error('Select a product and enter a valid quantity');
    setSaving(true);
    try {
      await api.post(endpoint, { productId: Number(productId), qty: Number(qty), rate: rate ? Number(rate) : undefined, reference, remarks });
      toast.success('Stock movement recorded');
      setProductId(''); setQty(''); setRate(''); setReference(''); setRemarks('');
      qc.invalidateQueries({ queryKey: ['stock-ledger-recent'] });
      qc.invalidateQueries({ queryKey: ['current-stock'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<any>[] = [
    { key: 'date', header: 'Date', render: (t) => formatDate(t.date) },
    { key: 'product', header: 'Product', render: (t) => t.product.name },
    { key: 'qty', header: 'Qty', align: 'right', render: (t) => formatNumber(Number(t.qtyIn) || Number(t.qtyOut)) },
    { key: 'reference', header: 'Reference', render: (t) => t.reference || '-' },
    { key: 'remarks', header: 'Remarks', render: (t) => t.remarks || '-' },
  ];

  return (
    <div>
      <PageHeader title={title} description={description} />
      <form onSubmit={handleSubmit} className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
        <div className="md:col-span-2">
          <label className="label">Product *</label>
          <select className="input" required value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select product</option>
            {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </select>
        </div>
        <div><label className="label">Quantity *</label><input type="number" step="0.001" className="input" required value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        {showRate && <div><label className="label">Rate</label><input type="number" step="0.01" className="input" value={rate} onChange={(e) => setRate(e.target.value)} /></div>}
        <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div><label className="label">Remarks</label><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        <div className="md:col-span-5 flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">Save</button>
        </div>
      </form>

      <h2 className="text-sm font-semibold text-ink mb-2">Recent Entries</h2>
      <DataTable columns={columns} rows={recent ?? []} loading={isLoading} emptyMessage="No entries yet" />
    </div>
  );
}
