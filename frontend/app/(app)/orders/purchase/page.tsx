'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, FileText } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { OrderItemsEditor, OrderItem, emptyOrderItem } from '@/components/forms/OrderItemsEditor';
import { formatDate } from '@/lib/utils';

interface PurchaseOrder { id: number; orderNo: string; date: string; dueDate?: string; vendor: { name: string }; status: string; items: any[] }

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<OrderItem[]>([{ ...emptyOrderItem }]);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders'], queryFn: async () => (await api.get('/purchase-orders', { params: { pageSize: 50 } })).data });
  const { data: vendors } = useQuery({ queryKey: ['vendors-all'], queryFn: async () => (await api.get('/vendors', { params: { pageSize: 200 } })).data.data, enabled: modalOpen });
  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data, enabled: modalOpen });

  function openCreate() { setVendorId(''); setDueDate(''); setItems([{ ...emptyOrderItem }]); setModalOpen(true); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((i) => i.productId && Number(i.qty) > 0);
    if (!vendorId || validItems.length === 0) return toast.error('Select vendor and add at least one item');
    setSaving(true);
    try {
      await api.post('/purchase-orders', {
        vendorId: Number(vendorId), dueDate: dueDate || undefined,
        items: validItems.map((i) => ({ productId: Number(i.productId), qty: Number(i.qty), rate: Number(i.rate) })),
      });
      toast.success('Purchase order created');
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<PurchaseOrder>[] = [
    { key: 'orderNo', header: 'Order No' },
    { key: 'date', header: 'Date', render: (o) => formatDate(o.date) },
    { key: 'dueDate', header: 'Due Date', render: (o) => (o.dueDate ? formatDate(o.dueDate) : '-') },
    { key: 'vendor', header: 'Vendor', render: (o) => o.vendor.name },
    { key: 'items', header: 'Items', render: (o) => o.items.length },
    { key: 'status', header: 'Status', render: (o) => <Badge status={o.status} /> },
    { key: 'actions', header: '', align: 'right', render: (o) => <button className="btn-ghost !px-2 !py-1" onClick={(e) => { e.stopPropagation(); openFile(`/documents/purchase-order/${o.id}`); }}><FileText size={14} /></button> },
  ];

  return (
    <div>
      <PageHeader title="Purchase Orders" description="Orders placed with vendors — track receipt against ordered quantities"
        actions={<button className="btn-primary" onClick={openCreate}><Plus size={15} /> New Purchase Order</button>} />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} onRowClick={(o) => router.push(`/purchases/new?purchaseOrderId=${o.id}`)} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Purchase Order" width="max-w-xl">
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Vendor *</label>
              <select className="input" required value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Select vendor</option>
                {vendors?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div><label className="label">Due Date</label><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <OrderItemsEditor items={items} onChange={setItems} products={products ?? []} rateField="purchaseRate" />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">Create Order</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
