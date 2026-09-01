'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { LineItemsEditor, LineItem, emptyLineItem } from '@/components/forms/LineItemsEditor';
import { formatCurrency } from '@/lib/utils';

export default function SaleEntryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const salesOrderId = searchParams.get('salesOrderId');
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState('0');
  const [paidAmount, setPaidAmount] = useState('0');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ ...emptyLineItem }]);
  const [saving, setSaving] = useState(false);

  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: async () => (await api.get('/customers', { params: { pageSize: 200 } })).data.data });
  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data });
  const { data: linkedOrder } = useQuery({
    queryKey: ['sales-order-for-sale', salesOrderId],
    queryFn: async () => (await api.get(`/sales-orders/${salesOrderId}`)).data.data,
    enabled: !!salesOrderId,
  });

  useEffect(() => {
    if (!linkedOrder) return;
    setCustomerId(String(linkedOrder.customerId));
    const pendingItems = linkedOrder.items
      .filter((i: any) => Number(i.deliveredQty) < Number(i.orderedQty))
      .map((i: any) => ({
        productId: String(i.productId),
        qty: String(Number(i.orderedQty) - Number(i.deliveredQty)),
        rate: String(i.rate),
        discount: '0',
        taxRate: '0',
      }));
    if (pendingItems.length > 0) setItems(pendingItems);
  }, [linkedOrder]);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((i) => i.productId && Number(i.qty) > 0);
    if (!customerId) return toast.error('Please select a customer');
    if (validItems.length === 0) return toast.error('Add at least one item');

    setSaving(true);
    try {
      const res = await api.post('/sales', {
        customerId: Number(customerId),
        date,
        discount: Number(discount),
        paidAmount: Number(paidAmount),
        paymentMode,
        remarks,
        salesOrderId: salesOrderId ? Number(salesOrderId) : undefined,
        items: validItems.map((i) => ({ productId: Number(i.productId), qty: Number(i.qty), rate: Number(i.rate), discount: Number(i.discount), taxRate: Number(i.taxRate) })),
      });
      toast.success(`Sale ${res.data.data.invoiceNo} created`);
      router.push(`/sales/${res.data.data.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sale Entry"
        description={linkedOrder ? `Fulfilling Sales Order ${linkedOrder.orderNo} — stock and customer ledger update automatically` : 'Record a new sale — stock and customer ledger update automatically'}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Customer *</label>
            <select className="input" required disabled={!!salesOrderId} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select customer</option>
              {customers?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Overall Discount</label><input type="number" step="0.01" className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div><label className="label">Remarks</label><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        </div>

        <LineItemsEditor items={items} onChange={setItems} products={products ?? []} rateField="saleRate" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-ink">Payment (optional, at invoice time)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Paid Amount</label><input type="number" step="0.01" className="input" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} /></div>
              <div>
                <label className="label">Payment Mode</label>
                <select className="input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                  {['CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="card p-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Discount</span><span>-{formatCurrency(discount)}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Tax</span><span>{formatCurrency(totals.tax)}</span></div>
            <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-card-border"><span>Grand Total</span><span>{formatCurrency(totals.grandTotal)}</span></div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="submit" disabled={saving} className="btn-primary">Save Sale</button>
        </div>
      </form>
    </div>
  );
}
