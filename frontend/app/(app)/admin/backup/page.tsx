'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { DatabaseBackup, Download } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { openFile } from '@/lib/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { formatDateTime } from '@/lib/utils';

interface Backup { filename: string; sizeBytes: number; createdAt: string }

export default function BackupPage() {
  const [running, setRunning] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['backups'], queryFn: async () => (await api.get('/backup')).data.data as Backup[] });

  async function runBackup() {
    setRunning(true);
    try {
      await api.post('/backup/run');
      toast.success('Backup created');
      qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  const columns: Column<Backup>[] = [
    { key: 'filename', header: 'File' },
    { key: 'sizeBytes', header: 'Size', align: 'right', render: (b) => `${(b.sizeBytes / 1024 / 1024).toFixed(2)} MB` },
    { key: 'createdAt', header: 'Created', render: (b) => formatDateTime(b.createdAt) },
    { key: 'actions', header: '', align: 'right', render: (b) => <button className="btn-ghost !px-2 !py-1" onClick={() => openFile(`/backup/download/${b.filename}`, b.filename)}><Download size={14} /></button> },
  ];

  return (
    <div>
      <PageHeader title="Backup & Restore" description="Database backups via MySQL's mysqldump. Restore from the command line — see the README for step-by-step instructions."
        actions={<button className="btn-primary" onClick={runBackup} disabled={running}><DatabaseBackup size={15} /> Run Backup Now</button>} />
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} emptyMessage="No backups yet — click 'Run Backup Now'." />
    </div>
  );
}
