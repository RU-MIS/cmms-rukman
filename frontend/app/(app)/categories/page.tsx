'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';

interface Category { id: number; name: string; active: boolean }

export default function CategoriesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get('/categories')).data.data as Category[],
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/categories', { name });
      toast.success('Category created');
      setModalOpen(false);
      setName('');
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleDelete(c: Category) {
    try {
      await api.delete(`/categories/${c.id}`);
      toast.success('Category deleted');
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns: Column<Category>[] = [
    { key: 'name', header: 'Category Name' },
    { key: 'active', header: 'Status', render: (c) => <Badge status={c.active ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'actions', header: '', align: 'right', render: (c) => <button className="btn-ghost !px-2 !py-1" onClick={() => handleDelete(c)}><Trash2 size={14} /></button> },
  ];

  return (
    <div>
      <PageHeader title="Product Categories" description="Group products for reporting and organization"
        actions={<button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> New Category</button>} />
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Category" width="max-w-sm">
        <form onSubmit={handleCreate} className="space-y-3">
          <div><label className="label">Category Name *</label><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
