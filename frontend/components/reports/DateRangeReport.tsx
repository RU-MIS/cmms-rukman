'use client';

import { ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

export function DateRangeReport({
  title, description, endpoint, queryKey, children,
}: {
  title: string;
  description: string;
  endpoint: string;
  queryKey: string;
  children: (rows: any[], loading: boolean) => ReactNode;
}) {
  const [fromDate, setFromDate] = useState(defaultFrom());
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: [queryKey, fromDate, toDate],
    queryFn: async () => (await api.get(endpoint, { params: { fromDate, toDate } })).data.data,
  });

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={<button className="btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>}
      />
      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <div><label className="label">From Date</label><input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div><label className="label">To Date</label><input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
      </div>
      {children(data ?? [], isLoading)}
    </div>
  );
}
