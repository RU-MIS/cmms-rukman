'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';

interface Warehouse { id: number; name: string; address?: string; active: boolean }

export default function WarehousesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: '', address: '' });
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data.data as Warehouse[],
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/warehouses', form);
      toast.success('Warehouse created');
      setModalOpen(false);
      setForm({ name: '', address: '' });
      qc.invalidateQueries({ queryKey: ['warehouses'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns: Column<Warehouse>[] = [
    { key: 'name', header: 'Warehouse Name' },
    { key: 'address', header: 'Address' },
    { key: 'active', header: 'Status', render: (w) => <Badge status={w.active ? 'ACTIVE' : 'INACTIVE'} /> },
  ];

  return (
    <div>
      <PageHeader title="Warehouses" description="Storage locations for multi-warehouse stock tracking"
        actions={<button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> New Warehouse</button>} />
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Warehouse" width="max-w-sm">
        <form onSubmit={handleCreate} className="space-y-3">
          <div><label className="label">Name *</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
