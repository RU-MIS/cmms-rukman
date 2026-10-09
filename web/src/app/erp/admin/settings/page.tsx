'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { rpc, sb } from '@/lib/supabase';
import { useCompanyId } from '@/lib/session';
import { useData } from '@/lib/useData';
import { ASSET_BUCKET, ASSET_MAX_BYTES, ASSET_TYPES, contrastRatio, readableBrand, useAssetUrl } from '@/lib/branding';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs, TextArea, Toggle, useAction } from '@/components/ui';

type Values = Record<string, unknown>;
type Section = Values & { can_edit: boolean };
type Kind = 'text' | 'textarea' | 'bool' | 'int' | 'select' | 'color' | 'roles' | 'days' | 'list' | 'date' | 'file';
interface Def { key: string; label: string; kind: Kind; hint?: string; options?: { value: string; label: string }[]; min?: number; max?: number }

const VIS = [{ value: 'HIDDEN', label: 'Hidden — no quantity' }, { value: 'EXACT_QUANTITY', label: 'Exact quantity (available)' },
  { value: 'AVAILABLE_STATUS', label: 'Status only — In stock / Low / Out' }, { value: 'AVAILABLE_TO_PROMISE', label: 'Available to promise' }];
const FREQ = [{ value: 'DAILY', label: 'Daily' }, { value: 'WEEKLY', label: 'Weekly' }];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((m, i) => ({ value: String(i + 1), label: m }));

/** Every setting belongs to one section with its own view / edit right (Owner decides who may change what). */
const SECTIONS: { id: string; label: string; fields: Def[] }[] = [
  { id: 'company', label: 'Company', fields: [
    { key: 'legal_name', label: 'Legal name *', kind: 'text' }, { key: 'trade_name', label: 'Trade name', kind: 'text' },
    { key: 'gstin', label: 'GSTIN', kind: 'text' }, { key: 'pan', label: 'PAN', kind: 'text' },
    { key: 'address_line1', label: 'Address line 1', kind: 'text' }, { key: 'address_line2', label: 'Address line 2', kind: 'text' },
    { key: 'city', label: 'City', kind: 'text' }, { key: 'state', label: 'State', kind: 'text' }, { key: 'state_code', label: 'State code', kind: 'text' },
    { key: 'pincode', label: 'PIN code', kind: 'text' }, { key: 'phone', label: 'Phone', kind: 'text' }, { key: 'email', label: 'Email', kind: 'text' },
    { key: 'website', label: 'Website', kind: 'text' },
    { key: 'fy_start_month', label: 'Financial year starts in', kind: 'select', options: MONTHS },
    { key: 'books_locked_until', label: 'Books locked up to (only the Owner can re-open)', kind: 'date' }] },
  { id: 'branding', label: 'Branding', fields: [
    { key: 'app_name', label: 'Application name', kind: 'text', hint: 'Shown in the header and the browser tab' },
    { key: 'short_name', label: 'Short name', kind: 'text', hint: 'Menu title (max 20 characters)' },
    { key: 'primary_color', label: 'Primary colour', kind: 'color' },
    { key: 'logo_path', label: 'Logo (PNG / JPEG / WebP, max 1 MB)', kind: 'file' },
    { key: 'favicon_path', label: 'Favicon (ICO / PNG, max 1 MB)', kind: 'file' },
    { key: 'document_footer', label: 'Document footer (PO PDF, emails)', kind: 'textarea' },
    { key: 'email_from_name', label: 'Email sender name', kind: 'text' },
    { key: 'email_reply_to', label: 'Email reply-to address', kind: 'text' }] },
  { id: 'inventory', label: 'Inventory', fields: [
    { key: 'allow_negative_stock', label: 'Allow negative stock', kind: 'bool', hint: 'OFF (recommended): issues beyond available stock are blocked' },
    { key: 'image_max_px', label: 'Item photos: largest side (pixels)', kind: 'int', min: 400, max: 4000, hint: 'Photos are resized in the browser before upload' },
    { key: 'image_quality', label: 'Item photos: quality (40–95)', kind: 'int', min: 40, max: 95 }] },
  { id: 'sales', label: 'Sales', fields: [
    { key: 'sale_rate_limit_policy', label: 'Minimum / maximum sale rate', kind: 'select',
      options: [{ value: 'OFF', label: 'Off' }, { value: 'WARN', label: 'Warn' }, { value: 'BLOCK', label: 'Block (override right with a reason)' }] }] },
  { id: 'purchase', label: 'Purchase', fields: [
    { key: 'purchase_terms', label: 'Terms printed on purchase orders', kind: 'textarea' }] },
  { id: 'documents', label: 'Documents', fields: [
    { key: 'document_max_mb', label: 'Largest upload (MB, 1–50)', kind: 'int', min: 1, max: 50 },
    { key: 'document_categories', label: 'Document categories (comma separated, empty = defaults)', kind: 'list' }] },
  { id: 'portal', label: 'Portals', fields: [
    { key: 'customer_portal_enabled', label: 'Customer portal', kind: 'bool' }, { key: 'vendor_portal_enabled', label: 'Vendor portal', kind: 'bool' },
    { key: 'customer_stock_visibility', label: 'Customer stock visibility', kind: 'select', options: VIS },
    { key: 'vendor_stock_visibility', label: 'Vendor stock visibility', kind: 'select', options: VIS },
    { key: 'customer_rate_visible', label: 'Customers see their rates', kind: 'bool' },
    { key: 'vendor_rate_visible', label: 'Vendors see PO rates', kind: 'bool' },
    { key: 'customer_quote_price_enabled', label: 'Customers may quote a price on a PO', kind: 'bool' },
    { key: 'customer_outstanding_visible', label: 'Customers see their outstanding', kind: 'bool' },
    { key: 'vendor_payment_visible', label: 'Vendors see payment status', kind: 'bool' }] },
  { id: 'email', label: 'Email', fields: [
    { key: 'email_automation', label: 'Email automation (master switch)', kind: 'bool', hint: 'OFF: no automatic email is generated or sent' },
    { key: 'vendor_po_email', label: 'Vendor PO email', kind: 'bool' }, { key: 'vendor_document_email', label: 'Vendor document email', kind: 'bool' },
    { key: 'customer_invoice_email', label: 'Customer invoice email', kind: 'bool' },
    { key: 'customer_document_email', label: 'Customer document email', kind: 'bool' },
    { key: 'payment_reminder_email', label: 'Customer payment reminder email', kind: 'bool' },
    { key: 'vendor_payment_reminder_email', label: 'Vendor payment reminder (internal)', kind: 'bool' },
    { key: 'email_max_attempts', label: 'Retry a failed email up to (attempts)', kind: 'int', min: 1, max: 20 }] },
  { id: 'reminders', label: 'Payment reminders', fields: [
    { key: 'customer_reminder_enabled', label: 'Customer payment reminder', kind: 'bool' },
    { key: 'customer_reminder_start_days', label: 'Customer: start days before due date', kind: 'days' },
    { key: 'customer_reminder_frequency', label: 'Customer reminder frequency', kind: 'select', options: FREQ },
    { key: 'vendor_reminder_enabled', label: 'Vendor payment reminder', kind: 'bool' },
    { key: 'vendor_reminder_start_days', label: 'Vendor: start days before due date', kind: 'days' },
    { key: 'vendor_reminder_frequency', label: 'Vendor reminder frequency', kind: 'select', options: FREQ },
    { key: 'vendor_reminder_roles', label: 'Notify these roles', kind: 'roles' }] },
  { id: 'approvals', label: 'Approvals', fields: [
    { key: 'rate_change_approval', label: 'Rate changes need approval', kind: 'bool',
      hint: 'A price or party-rate change by a user without “Approve rates” waits in the approval inbox' }] },
  { id: 'security', label: 'Security', fields: [
    { key: 'password_min_length', label: 'Minimum password length (8–64)', kind: 'int', min: 8, max: 64 },
    { key: 'password_require_mixed', label: 'Passwords need letters and digits', kind: 'bool' },
    { key: 'temp_password_valid_days', label: 'Temporary password valid for (days)', kind: 'int', min: 1, max: 90 },
    { key: 'idle_logout_minutes', label: 'Sign out after inactivity (minutes, empty = never)', kind: 'int', min: 5, max: 1440,
      hint: 'A convenience on the device; sessions are governed by Supabase Auth' }] },
];

export default function SettingsPage() {
  return <Suspense><SettingsSections /></Suspense>;
}

function SettingsSections() {
  const companyId = useCompanyId();
  const data = useData(() => rpc<Record<string, Section>>('settings_get', { p_company_id: companyId }), [companyId]);
  const [picked, setTab] = useState('');
  const want = useSearchParams().get('section');
  const visible = SECTIONS.filter((s) => data.data?.[s.id]);
  const tab = picked || (visible.find((s) => s.id === want) ?? visible[0])?.id || '';
  if (!data.data) return data.error ? <ErrorBox error={data.error} /> : <Spinner />;
  const sec = SECTIONS.find((s) => s.id === tab);
  return (
    <div>
      <PageHeader title="Settings" subtitle="Each section has its own view / edit right. Changes apply at once and are audited." />
      {visible.length === 0 ? <ErrorBox error="You cannot view any settings section." /> : (
        <>
          <Tabs tabs={visible.map((s) => ({ id: s.id, label: s.label }))} active={tab} onChange={setTab} />
          {sec && data.data[sec.id] && <SectionForm key={sec.id} companyId={companyId} section={sec} values={data.data[sec.id]} onSaved={data.reload} />}
        </>)}
    </div>
  );
}

function SectionForm({ companyId, section, values, onSaved }: { companyId: string; section: (typeof SECTIONS)[number]; values: Section; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Values>({});
  const editable = values.can_edit;
  const v = (k: string) => (k in draft ? draft[k] : values[k]);
  const set = (k: string, x: unknown) => setDraft({ ...draft, [k]: x });
  const changed = Object.keys(draft).length > 0;
  return (
    <Card title={`${section.label} settings`} actions={editable ? <>
      <Button variant="secondary" disabled={!changed} onClick={() => setDraft({})}>Discard</Button>
      <Button busy={busy} disabled={!changed} data-testid="settings-save" onClick={() => run(async () => {
        await rpc('settings_save', { p_company_id: companyId, p_section: section.id, p_payload: draft });
        setDraft({}); onSaved();
      }, `${section.label} settings saved`)}>Save</Button></> : undefined}>
      {!editable && <p className="mb-3 rounded-md bg-slate-50 p-2 text-sm text-slate-600">You can view this section; changing it needs the edit right of the section.</p>}
      <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
        {section.fields.map((f) => <FieldInput key={f.key} companyId={companyId} def={f} value={v(f.key)} disabled={!editable} onChange={(x) => set(f.key, x)} />)}
      </div>
    </Card>
  );
}

function FieldInput({ companyId, def, value, disabled, onChange }: { companyId: string; def: Def; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const roles = useData(async () => (def.kind === 'roles'
    ? (await sb().from('roles').select('code, name').eq('company_id', companyId).eq('kind', 'INTERNAL').order('name')).data ?? [] : []), [companyId, def.kind]);
  switch (def.kind) {
    case 'bool': return <div className="md:col-span-1"><Toggle label={def.label} hint={def.hint} checked={Boolean(value)} disabled={disabled} onChange={onChange} /></div>;
    case 'int': return <Field label={def.label} hint={def.hint}><Input type="number" min={def.min} max={def.max} disabled={disabled} value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} /></Field>;
    case 'select': return <Field label={def.label} hint={def.hint}><Select disabled={disabled} value={String(value ?? '')} options={def.options ?? []}
      onChange={(e) => onChange(def.key === 'fy_start_month' ? Number(e.target.value) : e.target.value)} /></Field>;
    case 'textarea': return <Field label={def.label} hint={def.hint} className="md:col-span-2"><TextArea rows={3} disabled={disabled} value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value || null)} /></Field>;
    case 'date': return <Field label={def.label} hint={def.hint}><Input type="date" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} /></Field>;
    case 'list': return <Field label={def.label} hint={def.hint}><Input disabled={disabled} value={((value as string[] | null) ?? []).join(', ')}
      onChange={(e) => { const l = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); onChange(l.length ? l : null); }} /></Field>;
    case 'days': return (
      <Field label={def.label}><div className="flex flex-wrap gap-2">
        {[10, 15, 20, 30].map((d) => <Button key={d} type="button" variant={Number(value) === d ? 'primary' : 'secondary'} disabled={disabled} onClick={() => onChange(d)}>{d}</Button>)}
        <Input aria-label={`${def.label} custom`} className="w-24" type="number" min="0" value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      </div></Field>);
    case 'roles': {
      const cur = (value as string[] | null) ?? [];
      return <div className="md:col-span-2"><span className="field-label">{def.label}</span><div className="flex flex-wrap gap-3">
        {(roles.data ?? []).map((r) => <label key={r.code} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={disabled} checked={cur.includes(r.code)}
          onChange={(e) => onChange(e.target.checked ? [...cur, r.code] : cur.filter((x) => x !== r.code))} />{r.name}</label>)}</div></div>;
    }
    case 'color': return <ColorInput label={def.label} value={(value as string | null) ?? ''} disabled={disabled} onChange={onChange} />;
    case 'file': return <AssetInput companyId={companyId} label={def.label} name={def.key === 'logo_path' ? 'logo' : 'favicon'} path={(value as string | null) ?? null}
      disabled={disabled} onChange={onChange} />;
    default: return <Field label={def.label} hint={def.hint}><Input disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} /></Field>;
  }
}

function ColorInput({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (v: string | null) => void }) {
  const ok = /^#[0-9a-f]{6}$/i.test(value);
  const ratio = ok ? contrastRatio(value, '#ffffff') : null;
  return (
    <Field label={label} hint={ratio !== null && ratio < 4.5
      ? `Contrast with white text is ${ratio.toFixed(1)}:1 — the app darkens it to ${readableBrand(value)} so text stays readable (WCAG AA)` : 'Hex value, e.g. #1F4E79'}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} picker`} disabled={disabled} value={ok ? value : '#1f4e79'} onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded border border-slate-300" />
        <Input aria-label={label} disabled={disabled} value={value} placeholder="#1F4E79" onChange={(e) => onChange(e.target.value || null)} />
        {ok && <span className="rounded px-2 py-1 text-xs text-white" style={{ background: readableBrand(value) }}>Sample</span>}
      </div>
    </Field>
  );
}

/** Branding file in the private company-assets bucket (<company>/<name>.<ext>); type and size checked here and by Storage. */
function AssetInput({ companyId, label, name, path, disabled, onChange }: { companyId: string; label: string; name: string; path: string | null;
  disabled: boolean; onChange: (v: string | null) => void }) {
  const url = useAssetUrl(path);
  const { busy, run } = useAction();
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="h-10 w-auto rounded border border-slate-200" /> : <span className="text-xs text-slate-500">None</span>}
        {!disabled && <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50">
          {busy ? 'Uploading…' : 'Upload'}
          <input type="file" className="hidden" aria-label={`${label} file`} accept={ASSET_TYPES.join(',')} onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            run(async () => {
              if (!ASSET_TYPES.includes(f.type)) throw new Error('Only PNG, JPEG, WebP or ICO images are allowed');
              if (f.size > ASSET_MAX_BYTES) throw new Error('The file is larger than 1 MB');
              const ext = f.name.split('.').pop()?.toLowerCase() ?? 'png';
              const p = `${companyId}/${name}-${Date.now()}.${ext}`;
              const { error } = await sb().storage.from(ASSET_BUCKET).upload(p, f, { contentType: f.type, upsert: false });
              if (error) throw error;
              onChange(p);
            }, 'Uploaded — save the section to apply it');
          }} />
        </label>}
        {!disabled && path && <Button variant="ghost" onClick={() => onChange(null)}>Remove</Button>}
      </div>
    </Field>
  );
}
