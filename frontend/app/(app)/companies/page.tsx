'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Check } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/store/authStore';

interface CompanyRow { id: number; name: string; gstin?: string | null; role: string; isDefault: boolean }

const emptyForm = { name: '', gstin: '', pan: '', address: '', state: '', financialYearStart: '4' };

export default function CompaniesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const setActiveCompany = useAuthStore((s) => s.setActiveCompany);

  const { data, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies')).data.data as CompanyRow[],
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/companies', {
        ...form,
        financialYearStart: Number(form.financialYearStart),
      });
      toast.success(`${res.data.data.company.name} created`);
      // Switch straight into the new company — it's the only useful place to land.
      setActiveCompany(res.data.data.token, { id: res.data.data.company.id, name: res.data.data.company.name, role: 'Admin' });
      window.location.href = '/dashboard';
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setSaving(false);
    }
  }

  const columns: Column<CompanyRow>[] = [
    { key: 'name', header: 'Company Name' },
    { key: 'gstin', header: 'GSTIN', render: (c) => c.gstin || '-' },
    { key: 'role', header: 'Your Role' },
    { key: 'isDefault', header: '', align: 'right', render: (c) => (c.id === activeCompany?.id ? <span className="inline-flex items-center gap-1 text-xs text-brand-600 font-medium"><Check size={13} /> Current</span> : null) },
  ];

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Every company workspace you have access to — switch between them from the header, or create a new one here."
        actions={<button className="btn-primary" onClick={() => { setForm(emptyForm); setModalOpen(true); }}><Plus size={15} /> Create New Company</button>}
      />
      <DataTable columns={columns} rows={data ?? []} loading={isLoading} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Create New Company" width="max-w-lg">
        <form onSubmit={handleCreate} className="space-y-3">
          <div><label className="label">Company Name *</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">GSTIN</label><input className="input" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
            <div><label className="label">PAN</label><input className="input" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} /></div>
          </div>
          <div><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">State</label><input className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
            <div>
              <label className="label">Financial Year Start</label>
              <select className="input" value={form.financialYearStart} onChange={(e) => setForm({ ...form, financialYearStart: e.target.value })}>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">Create Company</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
