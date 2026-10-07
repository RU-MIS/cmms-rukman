'use client';
import { useState } from 'react';
import { must, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { dateTime } from '@/lib/format';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Toggle, useAction } from '@/components/ui';

type S = Record<string, unknown>;
const VIS = [{ value: 'HIDDEN', label: 'Hidden — no quantity' }, { value: 'EXACT_QUANTITY', label: 'Exact quantity (available)' },
  { value: 'AVAILABLE_STATUS', label: 'Status only — In stock / Low / Out' }, { value: 'AVAILABLE_TO_PROMISE', label: 'Available to promise' }];
const FREQ = [{ value: 'DAILY', label: 'Daily' }, { value: 'WEEKLY', label: 'Weekly' }];
const DAYS = ['10', '15', '20', '30'];

export default function SettingsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const saved = useData(async () => must<S>(await sb().from('company_settings').select('*').eq('company_id', companyId).single()), [companyId]);
  const roles = useData(async () => must<{ code: string; name: string }[]>(await sb().from('roles').select('code, name').eq('company_id', companyId).order('name')), [companyId]);
  const [draft, setDraft] = useState<S>({});
  const editable = can('settings.edit');
  if (!saved.data) return saved.error ? <ErrorBox error={saved.error} /> : <Spinner />;
  const s = { ...saved.data, ...draft };
  const set = (k: string, v: unknown) => setDraft({ ...draft, [k]: v });
  const b = (k: string, label: string, hint?: string) => <Toggle label={label} hint={hint} checked={Boolean(s[k])} onChange={(v) => set(k, v)} disabled={!editable} />;
  const days = (k: string) => (
    <Field label="Start reminders this many days before the due date">
      <div className="flex flex-wrap gap-2">
        {DAYS.map((d) => <Button key={d} type="button" variant={String(s[k]) === d ? 'primary' : 'secondary'} disabled={!editable} onClick={() => set(k, Number(d))}>{d}</Button>)}
        <Input aria-label={`${k} custom`} className="w-24" type="number" min="0" value={String(s[k] ?? '')} disabled={!editable} onChange={(e) => set(k, Number(e.target.value))} />
      </div>
    </Field>);
  const changed = Object.keys(draft).length > 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Settings — control center" subtitle={`Owner / Admin only. Changes apply immediately — no code change needed. Last change ${dateTime(saved.data.updated_at)}`}
        actions={editable && <>
          <Button variant="secondary" disabled={!changed} onClick={() => setDraft({})}>Discard</Button>
          <Button busy={busy} disabled={!changed} onClick={() => run(async () => {
            must(await sb().from('company_settings').update(draft).eq('company_id', companyId));
            setDraft({}); saved.reload(); }, 'Settings saved')}>Save settings</Button></>} />
      {!editable && <ErrorBox error="You can view the settings; only the Owner or an Admin can change them." />}
      <CompanyProfile companyId={companyId} editable={editable} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Inventory">
          {b('allow_negative_stock', 'Allow negative stock', 'OFF (recommended): stock OUT / dispatch / transfer beyond available stock (physical − reserved) is blocked.')}
        </Card>
        <Card title="Portals">
          {b('customer_portal_enabled', 'Customer portal', 'Customers with portal access can log in')}
          {b('vendor_portal_enabled', 'Vendor portal', 'Vendors with portal access can log in')}
          {b('customer_outstanding_visible', 'Customers can see their outstanding')}
          {b('vendor_payment_visible', 'Vendors can see payment status & history')}
        </Card>
        <Card title="Customer visibility & pricing">
          <Field label="Customer stock visibility"><Select value={String(s.customer_stock_visibility)} disabled={!editable} onChange={(e) => set('customer_stock_visibility', e.target.value)} options={VIS} /></Field>
          {b('customer_rate_visible', 'Customer rate visibility', 'Show the customer his price in the catalog')}
          {b('customer_quote_price_enabled', 'Customer quote price', 'Customer may enter his requested price on a PO (always reviewed internally)')}
          <p className="mt-1 text-xs text-slate-500">Individual customers can be overridden in Customers & vendors → Visibility & email.</p>
        </Card>
        <Card title="Vendor visibility">
          <Field label="Vendor stock visibility"><Select value={String(s.vendor_stock_visibility)} disabled={!editable} onChange={(e) => set('vendor_stock_visibility', e.target.value)} options={VIS} /></Field>
          {b('vendor_rate_visible', 'Vendor rate visibility', 'Show rates on the vendor’s PO in the vendor portal')}
        </Card>
        <Card title="Email">
          {b('email_automation', 'Email automation (master switch)', 'OFF: no automatic email is generated or sent')}
          <div className="ml-4 border-l border-slate-200 pl-4">
            {b('vendor_po_email', 'Vendor PO email', 'PO PDF to the vendor when a PO is confirmed')}
            {b('vendor_document_email', 'Vendor document email', 'Uploaded vendor document + PO PDF')}
            {b('customer_invoice_email', 'Customer invoice email', 'Tally invoice PDF when uploaded')}
            {b('customer_document_email', 'Customer document email', 'Other documents uploaded for a customer')}
            {b('payment_reminder_email', 'Customer payment reminder email')}
            {b('vendor_payment_reminder_email', 'Vendor payment reminder (to internal users)')}
          </div>
          <Field label="Retry a failed email up to (attempts)"><Input type="number" min="1" max="20" disabled={!editable} value={String(s.email_max_attempts)} onChange={(e) => set('email_max_attempts', Number(e.target.value))} /></Field>
        </Card>
        <Card title="Payment reminders">
          {b('customer_reminder_enabled', 'Customer payment reminder', 'Emails the customer until the invoice is fully paid')}
          {days('customer_reminder_start_days')}
          <Field label="Customer reminder frequency" className="mt-2"><Select value={String(s.customer_reminder_frequency)} disabled={!editable} onChange={(e) => set('customer_reminder_frequency', e.target.value)} options={FREQ} /></Field>
          <hr className="my-3" />
          {b('vendor_reminder_enabled', 'Vendor payment reminder', 'Reminds internal users before a vendor bill is due')}
          {days('vendor_reminder_start_days')}
          <Field label="Vendor reminder frequency" className="mt-2"><Select value={String(s.vendor_reminder_frequency)} disabled={!editable} onChange={(e) => set('vendor_reminder_frequency', e.target.value)} options={FREQ} /></Field>
          <div className="mt-2"><span className="field-label">Notify these roles</span>
            <div className="flex flex-wrap gap-3">{(roles.data ?? []).map((r) => {
              const cur = (s.vendor_reminder_roles as string[]) ?? [];
              return <label key={r.code} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!editable} checked={cur.includes(r.code)}
                onChange={(e) => set('vendor_reminder_roles', e.target.checked ? [...cur, r.code] : cur.filter((x) => x !== r.code))} />{r.name}</label>;
            })}</div></div>
        </Card>
      </div>
    </div>
  );
}

const PROFILE = [['legal_name', 'Legal name *'], ['trade_name', 'Trade name'], ['gstin', 'GSTIN'], ['pan', 'PAN'], ['address_line1', 'Address line 1'],
  ['address_line2', 'Address line 2'], ['city', 'City'], ['state', 'State'], ['state_code', 'State code'], ['pincode', 'PIN code'],
  ['phone', 'Phone'], ['email', 'Email (reply-to of ERP emails)']] as const;

function CompanyProfile({ companyId, editable }: { companyId: string; editable: boolean }) {
  const { busy, run } = useAction();
  const co = useData(async () => must<Record<string, string | null>>(await sb().from('companies').select('*').eq('id', companyId).single()), [companyId]);
  const [d, setD] = useState<Record<string, string>>({});
  if (!co.data) return null;
  const v = (k: string) => d[k] ?? co.data?.[k] ?? '';
  return (
    <Card title="Company profile (printed on PO PDF and used in emails)" actions={editable && Object.keys(d).length > 0 &&
      <Button busy={busy} onClick={() => run(async () => {
        if (!v('legal_name').trim()) throw new Error('Legal name is required');
        must(await sb().from('companies').update(Object.fromEntries(Object.entries(d).map(([k, x]) => [k, x.trim() || null]))).eq('id', companyId));
        setD({}); co.reload(); }, 'Company profile saved')}>Save profile</Button>}>
      <div className="grid gap-3 md:grid-cols-3">
        {PROFILE.map(([k, l]) => <Field key={k} label={l}><Input value={v(k)} disabled={!editable} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></Field>)}
      </div>
    </Card>
  );
}
