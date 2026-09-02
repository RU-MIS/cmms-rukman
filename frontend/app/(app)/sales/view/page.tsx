'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FileText, Mail, Ban, ArrowLeft } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate } from '@/lib/utils';

function SaleDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState(false);

  const { data: sale, isLoading } = useQuery({
    queryKey: ['sale', id],
    queryFn: async () => (await api.get(`/sales/${id}`)).data.data,
  });

  async function handleCancel() {
    if (!confirm('Cancel this sale? Stock will be reversed. This cannot be undone.')) return;
    try {
      await api.post(`/sales/${id}/cancel`);
      toast.success('Sale cancelled');
      qc.invalidateQueries({ queryKey: ['sale', id] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await api.post('/email/send', { recipient, documentType: 'invoice', documentId: Number(id) });
      toast.success('Invoice emailed successfully');
      setEmailOpen(false);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (isLoading || !sale) return <p className="text-sm text-ink-muted">Loading…</p>;

  const balance = Number(sale.grandTotal) - Number(sale.paidAmount);

  return (
    <div>
      <PageHeader
        title={sale.invoiceNo}
        description={`${formatDate(sale.date)} — ${sale.customer.name}`}
        actions={
          <>
            <button className="btn-ghost" onClick={() => router.push('/sales')}><ArrowLeft size={15} /> Back</button>
            <button className="btn-secondary" onClick={() => openFile(`/documents/invoice/${id}`)}><FileText size={15} /> PDF</button>
            <button className="btn-secondary" onClick={() => { setRecipient(sale.customer.email ?? ''); setEmailOpen(true); }}><Mail size={15} /> Email</button>
            {sale.status === 'CONFIRMED' && <button className="btn-danger" onClick={handleCancel}><Ban size={15} /> Cancel Sale</button>}
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3"><p className="text-xs text-ink-muted">Status</p><Badge status={sale.status} /></div>
        <div className="card p-3"><p className="text-xs text-ink-muted">Grand Total</p><p className="font-semibold">{formatCurrency(sale.grandTotal)}</p></div>
        <div className="card p-3"><p className="text-xs text-ink-muted">Paid</p><p className="font-semibold text-success">{formatCurrency(sale.paidAmount)}</p></div>
        <div className="card p-3"><p className="text-xs text-ink-muted">Balance</p><p className="font-semibold text-danger">{formatCurrency(balance)}</p></div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr><th className="th">Product</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Discount</th><th className="th text-right">Tax</th><th className="th text-right">Total</th></tr>
          </thead>
          <tbody>
            {sale.items.map((item: any) => (
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

      {sale.remarks && <p className="text-sm text-ink-muted mt-3">Remarks: {sale.remarks}</p>}

      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} title="Email Invoice" width="max-w-sm">
        <form onSubmit={handleEmail} className="space-y-3">
          <div><label className="label">Recipient Email *</label><input type="email" required className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEmailOpen(false)}>Cancel</button><button type="submit" disabled={sending} className="btn-primary">Send</button></div>
        </form>
      </Modal>
    </div>
  );
}

export default function SaleDetailPage() {
  return (
    <Suspense fallback={null}>
      <SaleDetailContent />
    </Suspense>
  );
}
