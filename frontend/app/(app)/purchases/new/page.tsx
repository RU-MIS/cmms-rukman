'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { LineItemsEditor, LineItem, emptyLineItem } from '@/components/forms/LineItemsEditor';
import { formatCurrency } from '@/lib/utils';

export default function PurchaseEntryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const purchaseOrderId = searchParams.get('purchaseOrderId');
  const [vendorId, setVendorId] = useState('');
  const [vendorBillNo, setVendorBillNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState('0');
  const [paidAmount, setPaidAmount] = useState('0');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ ...emptyLineItem }]);
  const [saving, setSaving] = useState(false);

  const { data: vendors } = useQuery({ queryKey: ['vendors-all'], queryFn: async () => (await api.get('/vendors', { params: { pageSize: 200 } })).data.data });
  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data });
  const { data: linkedOrder } = useQuery({
    queryKey: ['purchase-order-for-purchase', purchaseOrderId],
    queryFn: async () => (await api.get(`/purchase-orders/${purchaseOrderId}`)).data.data,
    enabled: !!purchaseOrderId,
  });

  useEffect(() => {
    if (!linkedOrder) return;
    setVendorId(String(linkedOrder.vendorId));
    const pendingItems = linkedOrder.items
      .filter((i: any) => Number(i.receivedQty) < Number(i.orderedQty))
      .map((i: any) => ({
        productId: String(i.productId),
        qty: String(Number(i.orderedQty) - Number(i.receivedQty)),
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
    if (!vendorId) return toast.error('Please select a vendor');
    if (validItems.length === 0) return toast.error('Add at least one item');

    setSaving(true);
    try {
      const res = await api.post('/purchases', {
        vendorId: Number(vendorId),
        vendorBillNo,
        date,
        discount: Number(discount),
        paidAmount: Number(paidAmount),
        paymentMode,
        remarks,
        purchaseOrderId: purchaseOrderId ? Number(purchaseOrderId) : undefined,
        items: validItems.map((i) => ({ productId: Number(i.productId), qty: Number(i.qty), rate: Number(i.rate), discount: Number(i.discount), taxRate: Number(i.taxRate) })),
      });
      toast.success(`Purchase ${res.data.data.billNo} created`);
      router.push(`/purchases/${res.data.data.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchase Entry"
        description={linkedOrder ? `Fulfilling Purchase Order ${linkedOrder.orderNo} — stock and vendor ledger update automatically` : 'Record a new purchase — stock and vendor ledger update automatically'}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Vendor *</label>
            <select className="input" required disabled={!!purchaseOrderId} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Select vendor</option>
              {vendors?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div><label className="label">Vendor Bill No</label><input className="input" value={vendorBillNo} onChange={(e) => setVendorBillNo(e.target.value)} /></div>
          <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Overall Discount</label><input type="number" step="0.01" className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
        </div>

        <LineItemsEditor items={items} onChange={setItems} products={products ?? []} rateField="purchaseRate" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-ink">Payment (optional, at bill time)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Paid Amount</label><input type="number" step="0.01" className="input" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} /></div>
              <div>
                <label className="label">Payment Mode</label>
                <select className="input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                  {['CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div><label className="label">Remarks</label><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
          </div>
          <div className="card p-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Discount</span><span>-{formatCurrency(discount)}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Tax</span><span>{formatCurrency(totals.tax)}</span></div>
            <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-card-border"><span>Grand Total</span><span>{formatCurrency(totals.grandTotal)}</span></div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="submit" disabled={saving} className="btn-primary">Save Purchase</button>
        </div>
      </form>
    </div>
  );
}
