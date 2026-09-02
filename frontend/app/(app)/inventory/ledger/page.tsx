'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, FileSpreadsheet } from 'lucide-react';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { formatDate, formatNumber } from '@/lib/utils';

export default function StockLedgerPage() {
  const [productId, setProductId] = useState('');
  const [page, setPage] = useState(1);

  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: async () => (await api.get('/products', { params: { pageSize: 500 } })).data.data });
  const { data, isLoading } = useQuery({
    queryKey: ['stock-ledger', productId, page],
    queryFn: async () => (await api.get('/inventory/ledger', { params: { productId: productId || undefined, page, pageSize: 25 } })).data,
  });

  const columns: Column<any>[] = [
    { key: 'date', header: 'Date', render: (t) => formatDate(t.date) },
    { key: 'product', header: 'Product', render: (t) => t.product.name },
    { key: 'type', header: 'Type', render: (t) => <Badge status={t.type} /> },
    { key: 'qtyIn', header: 'In', align: 'right', render: (t) => (Number(t.qtyIn) ? formatNumber(t.qtyIn) : '-') },
    { key: 'qtyOut', header: 'Out', align: 'right', render: (t) => (Number(t.qtyOut) ? formatNumber(t.qtyOut) : '-') },
    { key: 'balanceAfter', header: 'Balance', align: 'right', render: (t) => formatNumber(t.balanceAfter) },
    { key: 'reference', header: 'Reference', render: (t) => t.reference || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Stock Ledger"
        description="Full movement history for any product"
        actions={
          <>
            {productId && <button className="btn-secondary" onClick={() => openFile(`/documents/stock-ledger?productId=${productId}`)}><FileText size={15} /> PDF</button>}
            <button className="btn-secondary" onClick={() => openFile('/excel/export/stock-ledger', 'stock-ledger.xlsx')}><FileSpreadsheet size={15} /> Export Excel</button>
          </>
        }
      />
      <div className="card p-4 mb-4 max-w-sm">
        <label className="label">Filter by Product</label>
        <select className="input" value={productId} onChange={(e) => { setProductId(e.target.value); setPage(1); }}>
          <option value="">All products</option>
          {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
        </select>
      </div>
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />
      {data?.meta && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPageChange={setPage} />}
    </div>
  );
}
