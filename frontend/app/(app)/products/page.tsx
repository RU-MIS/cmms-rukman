'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Power } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useDebouncedValue } from '@/lib/hooks';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface Product {
  id: number;
  sku: string;
  name: string;
  category?: { name: string };
  unit: { shortName: string };
  purchaseRate: string;
  saleRate: string;
  currentStock: string;
  reorderLevel: string;
  active: boolean;
}

const emptyForm = {
  name: '', categoryId: '', unitId: '', purchaseRate: 0, saleRate: 0, taxRate: 0,
  openingStock: 0, reorderLevel: 0, isRawMaterial: false, description: '',
};

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['products', debouncedSearch, page],
    queryFn: async () => (await api.get('/products', { params: { search: debouncedSearch, page, pageSize: 20 } })).data,
  });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: async () => (await api.get('/categories')).data.data });
  const { data: units } = useQuery({ queryKey: ['units'], queryFn: async () => (await api.get('/units')).data.data });

  function openCreate() { setEditing(null); setForm(emptyForm); setModalOpen(true); }
  function openEdit(p: any) {
    setEditing(p);
    setForm({ ...emptyForm, ...p, categoryId: p.categoryId ?? '', unitId: p.unitId });
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, categoryId: form.categoryId || null, unitId: Number(form.unitId) };
      if (editing) { await api.put(`/products/${editing.id}`, payload); toast.success('Product updated'); }
      else { await api.post('/products', payload); toast.success('Product created'); }
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Product) {
    try {
      await api.patch(`/products/${p.id}/toggle-active`);
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU' },
    { key: 'name', header: 'Product', render: (p) => <div><p className="font-medium">{p.name}</p>{p.category && <p className="text-xs text-ink-muted">{p.category.name}</p>}</div> },
    { key: 'saleRate', header: 'Sale Rate', align: 'right', render: (p) => formatCurrency(p.saleRate) },
    { key: 'purchaseRate', header: 'Purchase Rate', align: 'right', render: (p) => formatCurrency(p.purchaseRate) },
    { key: 'currentStock', header: 'Stock', align: 'right', render: (p) => `${formatNumber(p.currentStock)} ${p.unit.shortName}` },
    {
      key: 'status', header: 'Status',
      render: (p) => (Number(p.currentStock) <= Number(p.reorderLevel) ? <Badge status="LOW_STOCK" label="Low Stock" /> : <Badge status={p.active ? 'ACTIVE' : 'INACTIVE'} />),
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (p) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost !px-2 !py-1" onClick={() => openEdit(p)}><Pencil size={14} /></button>
          <button className="btn-ghost !px-2 !py-1" onClick={() => toggleActive(p)}><Power size={14} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Products"
        description="Manage your product catalog, rates and stock settings"
        actions={
          <>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search products…" />
            <button className="btn-primary" onClick={openCreate}><Plus size={15} /> New Product</button>
          </>
        }
      />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} onRowClick={openEdit} />
      {data?.meta && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPageChange={setPage} />}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Product' : 'New Product'} width="max-w-2xl">
        <form onSubmit={handleSave} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label">Product Name *</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">— None —</option>
              {categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Unit *</label>
            <select className="input" required value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
              <option value="">Select unit</option>
              {units?.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.shortName})</option>)}
            </select>
          </div>
          <div><label className="label">Purchase Rate</label><input type="number" step="0.01" className="input" value={form.purchaseRate} onChange={(e) => setForm({ ...form, purchaseRate: e.target.value })} /></div>
          <div><label className="label">Sale Rate</label><input type="number" step="0.01" className="input" value={form.saleRate} onChange={(e) => setForm({ ...form, saleRate: e.target.value })} /></div>
          <div><label className="label">Tax Rate (%)</label><input type="number" step="0.01" className="input" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} /></div>
          <div><label className="label">Reorder Level</label><input type="number" step="0.001" className="input" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></div>
          {!editing && <div><label className="label">Opening Stock</label><input type="number" step="0.001" className="input" value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} /></div>}
          <div className="flex items-center gap-2 mt-5">
            <input type="checkbox" id="isRaw" checked={form.isRawMaterial} onChange={(e) => setForm({ ...form, isRawMaterial: e.target.checked })} />
            <label htmlFor="isRaw" className="text-sm text-ink-muted">Raw material / BOM component</label>
          </div>
          <div className="col-span-2"><label className="label">Description</label><textarea className="input" rows={2} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{editing ? 'Save Changes' : 'Create Product'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
