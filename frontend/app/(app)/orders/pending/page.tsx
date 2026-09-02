'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { formatDate } from '@/lib/utils';
import { ClipboardList, Clock, AlertTriangle, PackageCheck } from 'lucide-react';

export default function PendingOrdersPage() {
  const [tab, setTab] = useState<'sales' | 'purchase'>('sales');

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['pending-sales-orders'],
    queryFn: async () => (await api.get('/sales-orders/pending/tracking')).data,
  });
  const { data: purchaseData, isLoading: purchaseLoading } = useQuery({
    queryKey: ['pending-purchase-orders'],
    queryFn: async () => (await api.get('/purchase-orders/pending/tracking')).data,
  });

  const rows = tab === 'sales' ? salesData?.data ?? [] : purchaseData?.data ?? [];
  const meta = tab === 'sales' ? salesData?.meta : purchaseData?.meta;
  const loading = tab === 'sales' ? salesLoading : purchaseLoading;

  const columns: Column<any>[] = [
    { key: 'orderNo', header: 'Order No' },
    { key: 'orderDate', header: 'Order Date', render: (r) => formatDate(r.orderDate) },
    { key: 'party', header: tab === 'sales' ? 'Customer' : 'Vendor', render: (r) => r.customer ?? r.vendor },
    { key: 'product', header: 'Product' },
    { key: 'orderedQty', header: 'Ordered', align: 'right' },
    { key: 'fulfilledQty', header: tab === 'sales' ? 'Delivered' : 'Received', align: 'right', render: (r) => r.deliveredQty ?? r.receivedQty },
    { key: 'pendingQty', header: 'Pending', align: 'right', render: (r) => <span className="font-medium text-warning">{r.pendingQty}</span> },
    { key: 'dueDate', header: 'Due Date', render: (r) => (r.dueDate ? formatDate(r.dueDate) : '-') },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.overdue ? 'OVERDUE' : r.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Pending Order Tracking" description="Orders awaiting full delivery / receipt" />

      <div className="flex gap-2 mb-4">
        <button className={tab === 'sales' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('sales')}>Sales Orders</button>
        <button className={tab === 'purchase' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('purchase')}>Purchase Orders</button>
      </div>

      {meta && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total Pending Lines" value={String(meta.totalPending ?? rows.length)} icon={ClipboardList} tone="info" />
          {tab === 'sales' && <StatCard label="Due Today" value={String(meta.dueToday ?? 0)} icon={Clock} tone="warning" />}
          <StatCard label="Overdue" value={String(meta.overdue ?? 0)} icon={AlertTriangle} tone="danger" />
          <StatCard label="Partially Fulfilled" value={String(meta.partiallyDelivered ?? meta.partiallyReceived ?? 0)} icon={PackageCheck} tone="success" />
        </div>
      )}

      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No pending orders — everything is fulfilled." />
    </div>
  );
}
