'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime } from '@/lib/utils';

interface AuditLog { id: number; action: string; module: string; recordId?: string; user?: { name: string }; ipAddress?: string; createdAt: string }

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [moduleFilter, setModuleFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, moduleFilter],
    queryFn: async () => (await api.get('/audit-logs', { params: { page, pageSize: 30, module: moduleFilter || undefined } })).data,
  });

  const columns: Column<AuditLog>[] = [
    { key: 'createdAt', header: 'Time', render: (l) => formatDateTime(l.createdAt) },
    { key: 'user', header: 'User', render: (l) => l.user?.name ?? 'System' },
    { key: 'action', header: 'Action' },
    { key: 'module', header: 'Module' },
    { key: 'recordId', header: 'Record' },
    { key: 'ipAddress', header: 'IP' },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Every create, update, delete and login/logout event, with who and when"
        actions={<input className="input w-52" placeholder="Filter by module…" value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(1); }} />}
      />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />
      {data?.meta && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPageChange={setPage} />}
    </div>
  );
}
