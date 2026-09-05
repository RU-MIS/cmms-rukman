'use client';

import { useMemo, useState } from 'react';
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
import { LineItemsEditor, LineItem, emptyLineItem } from '@/components/forms/LineItemsEditor';
import { formatDate, formatCurrency } from '@/lib/utils';

interface SalesOrder { id: number; orderNo: string; date: string; dueDate?: string; customer: { name: string }; status: string; items: any[] }

export default function SalesOrdersPage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [discount, setDiscount] = useState('0');
  const [items, setItems] = useState<LineItem[]>([{ ...emptyLineItem }]);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['sales-orders'], queryFn: async () => (await api.get('/sales-orders', { params: { pageSize: 50 } })).data });
  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: async () => (await api.get('/customers', { params: { pageSize: 200 } })).data.data, enabled: modalOpen });
  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data, enabled: modalOpen });

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const item of items) {
      const base = Number(item.qty || 0) * Number(item.rate || 0) - Number(item.discount || 0);
      subtotal += base;
      tax += (base * Number(item.taxRate || 0)) / 100;
    }
    const grandTotal = subtotal - Number(discount || 0) + tax;
    return { subtotal, tax, grandTotal };
  }, [items, discount]);

  function openCreate() { setCustomerId(''); setDueDate(''); setDiscount('0'); setItems([{ ...emptyLineItem }]); setModalOpen(true); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((i) => i.productId && Number(i.qty) > 0);
    if (!customerId || validItems.length === 0) return toast.error('Select customer and add at least one item');
    setSaving(true);
    try {
      await api.post('/sales-orders', {
        customerId: Number(customerId), dueDate: dueDate || undefined, discount: Number(discount),
        items: validItems.map((i) => ({ productId: Number(i.productId), qty: Number(i.qty), rate: Number(i.rate), discount: Number(i.discount), taxRate: Number(i.taxRate) })),
      });
      toast.success('Sales order created');
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<SalesOrder>[] = [
    { key: 'orderNo', header: 'Order No' },
    { key: 'date', header: 'Date', render: (o) => formatDate(o.date) },
    { key: 'dueDate', header: 'Due Date', render: (o) => (o.dueDate ? formatDate(o.dueDate) : '-') },
    { key: 'customer', header: 'Customer', render: (o) => o.customer.name },
    { key: 'items', header: 'Items', render: (o) => o.items.length },
    { key: 'status', header: 'Status', render: (o) => <Badge status={o.status} /> },
    { key: 'actions', header: '', align: 'right', render: (o) => <button className="btn-ghost !px-2 !py-1" onClick={(e) => { e.stopPropagation(); openFile(`/documents/sales-order/${o.id}`); }}><FileText size={14} /></button> },
  ];

  return (
    <div>
      <PageHeader title="Sales Orders" description="Customer orders — track delivery against ordered quantities"
        actions={<button className="btn-primary" onClick={openCreate}><Plus size={15} /> New Sales Order</button>} />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} onRowClick={(o) => router.push(`/sales/new?salesOrderId=${o.id}`)} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Sales Order" width="max-w-xl">
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Customer *</label>
              <select className="input" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer</option>
                {customers?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="label">Due Date</label><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <LineItemsEditor items={items} onChange={setItems} products={products ?? []} rateField="saleRate" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="label">Overall Discount</label><input type="number" step="0.01" className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
            <div className="card p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Discount</span><span>-{formatCurrency(discount)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Tax</span><span>{formatCurrency(totals.tax)}</span></div>
              <div className="flex justify-between font-semibold pt-1 border-t border-card-border"><span>Grand Total</span><span>{formatCurrency(totals.grandTotal)}</span></div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">Create Order</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
