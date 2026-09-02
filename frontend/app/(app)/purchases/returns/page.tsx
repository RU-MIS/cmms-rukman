'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate } from '@/lib/utils';

interface PurchaseReturn { id: number; returnNo: string; date: string; vendor: { name: string }; purchase: { billNo: string }; totalAmount: string }

export default function PurchaseReturnsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [purchaseId, setPurchaseId] = useState('');
  const [qtyByProduct, setQtyByProduct] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['purchase-returns'], queryFn: async () => (await api.get('/purchase-returns')).data });
  const { data: purchases } = useQuery({
    queryKey: ['purchases-for-return'],
    queryFn: async () => (await api.get('/purchases', { params: { pageSize: 100 } })).data.data,
    enabled: modalOpen,
  });
  const { data: purchaseDetail } = useQuery({
    queryKey: ['purchase-detail-for-return', purchaseId],
    queryFn: async () => (await api.get(`/purchases/${purchaseId}`)).data.data,
    enabled: !!purchaseId,
  });

  function openCreate() { setPurchaseId(''); setQtyByProduct({}); setModalOpen(true); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const items = Object.entries(qtyByProduct)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([productId, qty]) => ({ productId: Number(productId), qty: Number(qty), rate: purchaseDetail.items.find((i: any) => i.productId === Number(productId)).rate }));
    if (items.length === 0) return toast.error('Enter a return quantity for at least one item');
    setSaving(true);
    try {
      await api.post('/purchase-returns', { purchaseId: Number(purchaseId), items });
      toast.success('Purchase return recorded');
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<PurchaseReturn>[] = [
    { key: 'returnNo', header: 'Return No' },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'purchase', header: 'Bill', render: (r) => r.purchase.billNo },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor.name },
    { key: 'totalAmount', header: 'Amount', align: 'right', render: (r) => formatCurrency(r.totalAmount) },
  ];

  return (
    <div>
      <PageHeader title="Purchase Returns" description="Record goods returned to vendors"
        actions={<button className="btn-primary" onClick={openCreate}><Plus size={15} /> New Return</button>} />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Purchase Return" width="max-w-xl">
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="label">Original Purchase *</label>
            <select className="input" required value={purchaseId} onChange={(e) => { setPurchaseId(e.target.value); setQtyByProduct({}); }}>
              <option value="">Select bill</option>
              {purchases?.map((p: any) => <option key={p.id} value={p.id}>{p.billNo} — {p.vendor.name}</option>)}
            </select>
          </div>
          {purchaseDetail && (
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead><tr><th className="th">Product</th><th className="th text-right">Purchased Qty</th><th className="th text-right w-28">Return Qty</th></tr></thead>
                <tbody>
                  {purchaseDetail.items.map((item: any) => (
                    <tr key={item.id}>
                      <td className="td">{item.product.name}</td>
                      <td className="td text-right">{item.qty}</td>
                      <td className="td text-right">
                        <input
                          type="number" min={0} max={item.qty} step="0.001" className="input text-right"
                          value={qtyByProduct[item.productId] ?? ''}
                          onChange={(e) => setQtyByProduct({ ...qtyByProduct, [item.productId]: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving || !purchaseDetail} className="btn-primary">Save Return</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
