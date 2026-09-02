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

interface SaleReturn { id: number; returnNo: string; date: string; customer: { name: string }; sale: { invoiceNo: string }; totalAmount: string }

export default function SaleReturnsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [saleId, setSaleId] = useState('');
  const [qtyByProduct, setQtyByProduct] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['sale-returns'],
    queryFn: async () => (await api.get('/sale-returns')).data,
  });
  const { data: sales } = useQuery({
    queryKey: ['sales-for-return'],
    queryFn: async () => (await api.get('/sales', { params: { pageSize: 100 } })).data.data,
    enabled: modalOpen,
  });
  const { data: saleDetail } = useQuery({
    queryKey: ['sale-detail-for-return', saleId],
    queryFn: async () => (await api.get(`/sales/${saleId}`)).data.data,
    enabled: !!saleId,
  });

  function openCreate() { setSaleId(''); setQtyByProduct({}); setModalOpen(true); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const items = Object.entries(qtyByProduct)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([productId, qty]) => ({ productId: Number(productId), qty: Number(qty), rate: saleDetail.items.find((i: any) => i.productId === Number(productId)).rate }));
    if (items.length === 0) return toast.error('Enter a return quantity for at least one item');
    setSaving(true);
    try {
      await api.post('/sale-returns', { saleId: Number(saleId), items });
      toast.success('Sale return recorded');
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['sale-returns'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<SaleReturn>[] = [
    { key: 'returnNo', header: 'Return No' },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'sale', header: 'Invoice', render: (r) => r.sale.invoiceNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.name },
    { key: 'totalAmount', header: 'Amount', align: 'right', render: (r) => formatCurrency(r.totalAmount) },
  ];

  return (
    <div>
      <PageHeader title="Sales Returns" description="Record goods returned by customers"
        actions={<button className="btn-primary" onClick={openCreate}><Plus size={15} /> New Return</button>} />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Sale Return" width="max-w-xl">
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="label">Original Sale *</label>
            <select className="input" required value={saleId} onChange={(e) => { setSaleId(e.target.value); setQtyByProduct({}); }}>
              <option value="">Select invoice</option>
              {sales?.map((s: any) => <option key={s.id} value={s.id}>{s.invoiceNo} — {s.customer.name}</option>)}
            </select>
          </div>
          {saleDetail && (
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead><tr><th className="th">Product</th><th className="th text-right">Sold Qty</th><th className="th text-right w-28">Return Qty</th></tr></thead>
                <tbody>
                  {saleDetail.items.map((item: any) => (
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
            <button type="submit" disabled={saving || !saleDetail} className="btn-primary">Save Return</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
