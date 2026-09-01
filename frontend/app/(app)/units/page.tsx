'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';

interface Unit { id: number; name: string; shortName: string }

export default function UnitsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: '', shortName: '' });
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['units'],
    queryFn: async () => (await api.get('/units')).data.data as Unit[],
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/units', form);
      toast.success('Unit created');
      setModalOpen(false);
      setForm({ name: '', shortName: '' });
      qc.invalidateQueries({ queryKey: ['units'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleDelete(u: Unit) {
    try {
      await api.delete(`/units/${u.id}`);
      toast.success('Unit deleted');
      qc.invalidateQueries({ queryKey: ['units'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns: Column<Unit>[] = [
    { key: 'name', header: 'Unit Name' },
    { key: 'shortName', header: 'Short Name' },
    { key: 'actions', header: '', align: 'right', render: (u) => <button className="btn-ghost !px-2 !py-1" onClick={() => handleDelete(u)}><Trash2 size={14} /></button> },
  ];

  return (
    <div>
      <PageHeader title="Units of Measure" description="Pieces, Kg, Box, Litre, Meter etc."
        actions={<button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> New Unit</button>} />
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Unit" width="max-w-sm">
        <form onSubmit={handleCreate} className="space-y-3">
          <div><label className="label">Unit Name *</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Short Name *</label><input className="input" required value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
