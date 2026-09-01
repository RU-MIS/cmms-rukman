'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';

export default function SettingsPage() {
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get('/settings')).data.data });

  useEffect(() => { if (data) setForm(data); }, [data]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/settings', form);
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <p className="text-sm text-ink-muted">Loading…</p>;

  return (
    <div>
      <PageHeader title="Business Settings" description="Configure your business profile, numbering prefixes and PDF footer" />
      <form onSubmit={handleSave} className="card p-5 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
        <div className="md:col-span-2"><label className="label">Business Name</label><input className="input" value={form.businessName ?? ''} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /></div>
        <div className="md:col-span-2"><label className="label">Address</label><input className="input" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div><label className="label">Email</label><input className="input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="label">GSTIN</label><input className="input" value={form.gstin ?? ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
        <div><label className="label">Currency</label><input className="input" value={form.currency ?? ''} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
        <div><label className="label">Invoice Prefix</label><input className="input" value={form.invoicePrefix ?? ''} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })} /></div>
        <div><label className="label">Purchase Order Prefix</label><input className="input" value={form.poPrefix ?? ''} onChange={(e) => setForm({ ...form, poPrefix: e.target.value })} /></div>
        <div><label className="label">Sales Order Prefix</label><input className="input" value={form.soPrefix ?? ''} onChange={(e) => setForm({ ...form, soPrefix: e.target.value })} /></div>
        <div><label className="label">Payment Prefix</label><input className="input" value={form.paymentPrefix ?? ''} onChange={(e) => setForm({ ...form, paymentPrefix: e.target.value })} /></div>
        <div><label className="label">Default Tax Rate (%)</label><input type="number" step="0.01" className="input" value={form.defaultTaxRate ?? 0} onChange={(e) => setForm({ ...form, defaultTaxRate: e.target.value })} /></div>
        <div className="md:col-span-2"><label className="label">PDF Footer</label><textarea className="input" rows={2} value={form.pdfFooter ?? ''} onChange={(e) => setForm({ ...form, pdfFooter: e.target.value })} /></div>
        <div className="md:col-span-2 flex justify-end"><button type="submit" disabled={saving} className="btn-primary">Save Settings</button></div>
      </form>
    </div>
  );
}
