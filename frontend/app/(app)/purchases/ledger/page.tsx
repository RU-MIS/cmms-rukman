'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function PurchaseLedgerPage() {
  const [vendorId, setVendorId] = useState('');

  const { data: vendors } = useQuery({ queryKey: ['vendors-all'], queryFn: async () => (await api.get('/vendors', { params: { pageSize: 200 } })).data.data });
  const { data: ledger, isLoading } = useQuery({
    queryKey: ['vendor-ledger', vendorId],
    queryFn: async () => (await api.get(`/outstanding/vendors/${vendorId}/ledger`)).data.data,
    enabled: !!vendorId,
  });

  return (
    <div>
      <PageHeader
        title="Vendor Ledger"
        description="Opening balance + Purchases − Payments − Returns = Closing balance"
        actions={
          vendorId && (
            <button className="btn-secondary" onClick={() => openFile(`/documents/vendor-ledger/${vendorId}`)}>
              <FileText size={15} /> Download PDF
            </button>
          )
        }
      />
      <div className="card p-4 mb-4 max-w-sm">
        <label className="label">Select Vendor</label>
        <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Choose a vendor…</option>
          {vendors?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      {isLoading && <p className="text-sm text-ink-muted">Loading ledger…</p>}

      {ledger && (
        <div className="card overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr><th className="th">Date</th><th className="th">Type</th><th className="th">Reference</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th><th className="th text-right">Balance</th></tr>
            </thead>
            <tbody>
              {ledger.ledger.map((row: any, i: number) => (
                <tr key={i}>
                  <td className="td">{formatDate(row.date)}</td>
                  <td className="td">{row.type}</td>
                  <td className="td">{row.reference}</td>
                  <td className="td text-right">{Number(row.debit) ? formatCurrency(row.debit) : '-'}</td>
                  <td className="td text-right">{Number(row.credit) ? formatCurrency(row.credit) : '-'}</td>
                  <td className="td text-right font-medium">{formatCurrency(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
