'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Check, Pencil } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { GstinInput } from '@/components/forms/GstinInput';
import { useAuthStore } from '@/store/authStore';

interface CompanyRow { id: number; name: string; gstin?: string | null; role: string; isDefault: boolean }

const emptyForm = { name: '', gstin: '', pan: '', address: '', state: '', financialYearStart: '4' };

const emptyProfileForm = {
  name: '', legalName: '', tradeName: '', gstin: '', pan: '', businessType: '',
  address: '', state: '', district: '', pincode: '',
  registrationStatus: '', registrationDate: '', principalPlaceOfBusiness: '', natureOfBusiness: '',
};

export default function CompaniesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileForm, setProfileForm] = useState<any>(emptyProfileForm);
  const [profileCompanyId, setProfileCompanyId] = useState<number | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const setActiveCompany = useAuthStore((s) => s.setActiveCompany);
  const qc = useQueryClient();

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

  async function openProfile(companyId: number) {
    setProfileCompanyId(companyId);
    setProfileModalOpen(true);
    setProfileForm(emptyProfileForm);
    try {
      const res = await api.get(`/companies/${companyId}`);
      const c = res.data.data;
      setProfileForm({
        name: c.name ?? '',
        legalName: c.legalName ?? '',
        tradeName: c.tradeName ?? '',
        gstin: c.gstin ?? '',
        pan: c.pan ?? '',
        businessType: c.businessType ?? '',
        address: c.address ?? '',
        state: c.state ?? '',
        district: c.district ?? '',
        pincode: c.pincode ?? '',
        registrationStatus: c.registrationStatus ?? '',
        registrationDate: c.registrationDate ? String(c.registrationDate).slice(0, 10) : '',
        principalPlaceOfBusiness: c.principalPlaceOfBusiness ?? '',
        natureOfBusiness: c.natureOfBusiness ?? '',
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setProfileModalOpen(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileCompanyId) return;
    setSavingProfile(true);
    try {
      await api.put(`/companies/${profileCompanyId}`, profileForm);
      toast.success('GST profile updated');
      setProfileModalOpen(false);
      qc.invalidateQueries({ queryKey: ['companies'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  }

  const columns: Column<CompanyRow>[] = [
    { key: 'name', header: 'Company Name' },
    { key: 'gstin', header: 'GSTIN', render: (c) => c.gstin || '-' },
    { key: 'role', header: 'Your Role' },
    {
      key: 'isDefault', header: '', align: 'right',
      render: (c) => (c.id === activeCompany?.id ? <span className="inline-flex items-center gap-1 text-xs text-brand-600 font-medium"><Check size={13} /> Current</span> : null),
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (c) => (
        c.id === activeCompany?.id ? (
          <button className="btn-ghost !px-2 !py-1" title="Edit GST profile" onClick={() => openProfile(c.id)}><Pencil size={14} /></button>
        ) : null
      ),
    },
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
            <div className="col-span-2"><GstinInput value={form.gstin} onChange={(v) => setForm({ ...form, gstin: v })} /></div>
            <div><label className="label">PAN</label><input className="input" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} /></div>
            <div>
              <label className="label">Financial Year Start</label>
              <select className="input" value={form.financialYearStart} onChange={(e) => setForm({ ...form, financialYearStart: e.target.value })}>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div><label className="label">State</label><input className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">Create Company</button>
          </div>
        </form>
      </Modal>

      <Modal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} title="Company GST Profile" width="max-w-2xl">
        <form onSubmit={handleSaveProfile} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label">Company Name *</label><input className="input" required value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} /></div>
          <div><label className="label">Legal Name</label><input className="input" value={profileForm.legalName} onChange={(e) => setProfileForm({ ...profileForm, legalName: e.target.value })} /></div>
          <div><label className="label">Trade Name</label><input className="input" value={profileForm.tradeName} onChange={(e) => setProfileForm({ ...profileForm, tradeName: e.target.value })} /></div>
          <div className="col-span-2"><GstinInput value={profileForm.gstin} onChange={(v) => setProfileForm({ ...profileForm, gstin: v })} /></div>
          <div><label className="label">PAN</label><input className="input" value={profileForm.pan} onChange={(e) => setProfileForm({ ...profileForm, pan: e.target.value })} /></div>
          <div><label className="label">Business Constitution</label><input className="input" placeholder="e.g. Private Limited, Proprietorship" value={profileForm.businessType} onChange={(e) => setProfileForm({ ...profileForm, businessType: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Address</label><input className="input" value={profileForm.address} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} /></div>
          <div><label className="label">State</label><input className="input" value={profileForm.state} onChange={(e) => setProfileForm({ ...profileForm, state: e.target.value })} /></div>
          <div><label className="label">District</label><input className="input" value={profileForm.district} onChange={(e) => setProfileForm({ ...profileForm, district: e.target.value })} /></div>
          <div><label className="label">Pincode</label><input className="input" value={profileForm.pincode} onChange={(e) => setProfileForm({ ...profileForm, pincode: e.target.value })} /></div>
          <div><label className="label">Registration Status</label><input className="input" placeholder="e.g. Active" value={profileForm.registrationStatus} onChange={(e) => setProfileForm({ ...profileForm, registrationStatus: e.target.value })} /></div>
          <div><label className="label">Registration Date</label><input type="date" className="input" value={profileForm.registrationDate} onChange={(e) => setProfileForm({ ...profileForm, registrationDate: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Principal Place of Business</label><input className="input" value={profileForm.principalPlaceOfBusiness} onChange={(e) => setProfileForm({ ...profileForm, principalPlaceOfBusiness: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Nature of Business</label><input className="input" value={profileForm.natureOfBusiness} onChange={(e) => setProfileForm({ ...profileForm, natureOfBusiness: e.target.value })} /></div>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setProfileModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={savingProfile} className="btn-primary">Save Profile</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
