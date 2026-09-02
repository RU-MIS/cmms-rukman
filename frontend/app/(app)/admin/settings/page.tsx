'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');

export default function SettingsPage() {
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get('/settings')).data.data });
  const { data: pdfFonts } = useQuery({ queryKey: ['pdf-fonts'], queryFn: async () => (await api.get('/settings/pdf-fonts')).data.data as string[] });

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

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await api.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm((f: any) => ({ ...f, logoUrl: res.data.data.logoUrl }));
      toast.success('Logo uploaded');
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

        <div className="md:col-span-2 border-t border-border pt-4 mt-1">
          <h3 className="text-sm font-semibold text-ink mb-3">PDF & Document Branding</h3>
        </div>

        <div className="md:col-span-2">
          <label className="label">Company Logo</label>
          <div className="flex items-center gap-4">
            {form.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_ORIGIN}${form.logoUrl}`} alt="Company logo" className="h-16 w-auto border border-border rounded-md bg-white p-1" />
            ) : (
              <div className="h-16 w-16 flex items-center justify-center border border-dashed border-border rounded-md text-xs text-ink-muted">No logo</div>
            )}
            <div>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoChange} disabled={uploadingLogo} className="text-sm" />
              <p className="text-xs text-ink-muted mt-1">Shown on invoices and other generated PDFs. PNG/JPG recommended.</p>
            </div>
          </div>
        </div>

        <div>
          <label className="label">PDF Font</label>
          <select className="input" value={form.pdfFont ?? 'Helvetica'} onChange={(e) => setForm({ ...form, pdfFont: e.target.value })}>
            {(pdfFonts ?? ['Helvetica', 'Times-Roman', 'Courier']).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">PDF Page Scale (%)</label>
          <input
            type="number"
            min={50}
            max={150}
            className="input"
            value={form.pdfScale ?? 100}
            onChange={(e) => setForm({ ...form, pdfScale: e.target.value === '' ? '' : Number(e.target.value) })}
          />
          <p className="text-xs text-ink-muted mt-1">Shrink to e.g. 90% if PDFs don&apos;t fit on one A4 page.</p>
        </div>
        <div className="md:col-span-2">
          <label className="label">Terms &amp; Conditions (Invoice PDF)</label>
          <textarea className="input" rows={3} value={form.termsConditions ?? ''} onChange={(e) => setForm({ ...form, termsConditions: e.target.value })} />
        </div>

        <div className="md:col-span-2 flex justify-end"><button type="submit" disabled={saving} className="btn-primary">Save Settings</button></div>
      </form>
    </div>
  );
}
