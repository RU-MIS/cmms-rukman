'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatDate, formatNumber } from '@/lib/utils';

export default function StockTransferPage() {
  const [productId, setProductId] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [qty, setQty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data });
  const { data: warehouses } = useQuery({ queryKey: ['warehouses'], queryFn: async () => (await api.get('/warehouses')).data.data });
  const { data: recent, isLoading } = useQuery({
    queryKey: ['stock-ledger-transfers'],
    queryFn: async () => (await api.get('/inventory/ledger', { params: { pageSize: 20 } })).data.data.filter((t: any) => t.type.startsWith('TRANSFER')),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !fromWarehouseId || !toWarehouseId || !(Number(qty) > 0)) return toast.error('Fill all fields with a valid quantity');
    if (fromWarehouseId === toWarehouseId) return toast.error('Source and destination warehouse must differ');
    setSaving(true);
    try {
      await api.post('/inventory/transfer', { productId: Number(productId), fromWarehouseId: Number(fromWarehouseId), toWarehouseId: Number(toWarehouseId), qty: Number(qty), remarks });
      toast.success('Stock transferred');
      setProductId(''); setQty(''); setRemarks('');
      qc.invalidateQueries({ queryKey: ['stock-ledger-transfers'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<any>[] = [
    { key: 'date', header: 'Date', render: (t) => formatDate(t.date) },
    { key: 'product', header: 'Product', render: (t) => t.product.name },
    { key: 'type', header: 'Direction', render: (t) => (t.type === 'TRANSFER_OUT' ? 'Out of' : 'Into') },
    { key: 'warehouse', header: 'Warehouse', render: (t) => t.warehouse?.name ?? '-' },
    { key: 'qty', header: 'Qty', align: 'right', render: (t) => formatNumber(Number(t.qtyIn) || Number(t.qtyOut)) },
  ];

  return (
    <div>
      <PageHeader title="Stock Transfer" description="Move stock between warehouses" />
      <form onSubmit={handleSubmit} className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
        <div className="md:col-span-2">
          <label className="label">Product *</label>
          <select className="input" required value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select product</option>
            {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </select>
        </div>
        <div>
          <label className="label">From Warehouse *</label>
          <select className="input" required value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
            <option value="">Select</option>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">To Warehouse *</label>
          <select className="input" required value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
            <option value="">Select</option>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div><label className="label">Quantity *</label><input type="number" step="0.001" className="input" required value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="md:col-span-5"><label className="label">Remarks</label><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        <div className="md:col-span-5 flex justify-end"><button type="submit" disabled={saving} className="btn-primary">Transfer Stock</button></div>
      </form>

      <h2 className="text-sm font-semibold text-ink mb-2">Recent Transfers</h2>
      <DataTable columns={columns} rows={recent ?? []} loading={isLoading} emptyMessage="No transfers yet" />
    </div>
  );
}
