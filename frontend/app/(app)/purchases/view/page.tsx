'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FileText, Ban, ArrowLeft } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/utils';

function PurchaseDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';
  const router = useRouter();
  const qc = useQueryClient();

  const { data: purchase, isLoading } = useQuery({
    queryKey: ['purchase', id],
    queryFn: async () => (await api.get(`/purchases/${id}`)).data.data,
  });

  async function handleCancel() {
    if (!confirm('Cancel this purchase? Stock will be reversed. This cannot be undone.')) return;
    try {
      await api.post(`/purchases/${id}/cancel`);
      toast.success('Purchase cancelled');
      qc.invalidateQueries({ queryKey: ['purchase', id] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  if (isLoading || !purchase) return <p className="text-sm text-ink-muted">Loading…</p>;
  const balance = Number(purchase.grandTotal) - Number(purchase.paidAmount);

  return (
    <div>
      <PageHeader
        title={purchase.billNo}
        description={`${formatDate(purchase.date)} — ${purchase.vendor.name}`}
        actions={
          <>
            <button className="btn-ghost" onClick={() => router.push('/purchases')}><ArrowLeft size={15} /> Back</button>
            <button className="btn-secondary" onClick={() => openFile(`/documents/purchase/${id}`)}><FileText size={15} /> PDF</button>
            {purchase.status === 'CONFIRMED' && <button className="btn-danger" onClick={handleCancel}><Ban size={15} /> Cancel Purchase</button>}
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3"><p className="text-xs text-ink-muted">Status</p><Badge status={purchase.status} /></div>
        <div className="card p-3"><p className="text-xs text-ink-muted">Grand Total</p><p className="font-semibold">{formatCurrency(purchase.grandTotal)}</p></div>
        <div className="card p-3"><p className="text-xs text-ink-muted">Paid</p><p className="font-semibold text-success">{formatCurrency(purchase.paidAmount)}</p></div>
        <div className="card p-3"><p className="text-xs text-ink-muted">Balance</p><p className="font-semibold text-danger">{formatCurrency(balance)}</p></div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr><th className="th">Product</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Discount</th><th className="th text-right">Tax</th><th className="th text-right">Total</th></tr>
          </thead>
          <tbody>
            {purchase.items.map((item: any) => (
              <tr key={item.id}>
                <td className="td">{item.product.name} <span className="text-ink-faint">({item.product.unit.shortName})</span></td>
                <td className="td text-right">{item.qty}</td>
                <td className="td text-right">{formatCurrency(item.rate)}</td>
                <td className="td text-right">{formatCurrency(item.discount)}</td>
                <td className="td text-right">{formatCurrency(item.taxAmount)}</td>
                <td className="td text-right font-medium">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {purchase.remarks && <p className="text-sm text-ink-muted mt-3">Remarks: {purchase.remarks}</p>}
    </div>
  );
}

export default function PurchaseDetailPage() {
  return (
    <Suspense fallback={null}>
      <PurchaseDetailContent />
    </Suspense>
  );
}
