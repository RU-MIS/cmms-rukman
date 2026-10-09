'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useItems } from '@/lib/masters';
import { date, dateTime, money } from '@/lib/format';
import { adminUsers } from '@/lib/admin';
import { exportEntity } from '@/lib/spreadsheet';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, TextArea, useAction } from '@/components/ui';
import { CustomFieldsEditor, useCustomFields } from './CustomFields';
import { TempPasswordModal } from './widgets';

type Kind = 'CUSTOMER' | 'VENDOR';
const VENDOR_ROLES = ['SUPPLIER', 'JOB_WORKER', 'CUTTER'];
interface PartyRow { id: string; code: string; name: string; contact_person: string | null; mobile: string | null; phone: string | null;
  email: string | null; gstin: string | null; pan: string | null; address: string | null; city: string | null; state_code: string | null;
  pincode: string | null; credit_days: number; credit_limit: number | null; payment_terms: string | null; notes: string | null;
  is_active: boolean; custom: Record<string, unknown>; party_roles: { role: string }[] }
const COLS = 'id, code, name, contact_person, mobile, phone, email, gstin, pan, address, city, state_code, pincode, credit_days, credit_limit, '
  + 'payment_terms, notes, is_active, custom, party_roles!inner(role)';

/** Customer or vendor master (Admin control center). Rights: parties.*, rates.*, portal.* — enforced by the database. */
export function PartyAdmin({ kind }: { kind: Kind }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const roles = kind === 'CUSTOMER' ? ['CUSTOMER'] : VENDOR_ROLES;
  const list = useData(async () => {
    const rows = must<PartyRow[]>(await sb().from('parties').select(COLS).eq('company_id', companyId).eq('is_deleted', false)
      .in('party_roles.role', roles).order('name'));
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
  }, [companyId, kind]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [open, setOpen] = useState<Partial<PartyRow> | null>(null);
  const label = kind === 'CUSTOMER' ? 'Customers' : 'Vendors';
  const rows = useMemo(() => (list.data ?? []).filter((p) =>
    (!q || `${p.code} ${p.name} ${p.city ?? ''} ${p.email ?? ''} ${p.mobile ?? ''} ${p.gstin ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    && (!status || (status === 'ACTIVE') === p.is_active)), [list.data, q, status]);

  return (
    <div>
      <PageHeader title={label} subtitle={kind === 'CUSTOMER'
        ? 'Customer master, special rates, portal visibility and customer logins.'
        : 'Vendor master (suppliers, job workers, cutters), purchase rates, portal visibility and vendor logins.'}
        actions={<>
          {can('parties.create') && <Button onClick={() => setOpen({ is_active: true, credit_days: 0, custom: {},
            party_roles: [{ role: kind === 'CUSTOMER' ? 'CUSTOMER' : 'SUPPLIER' }] })}>New {kind === 'CUSTOMER' ? 'customer' : 'vendor'}</Button>}
          {can('parties.import') && <Link className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50"
            href={`/erp/admin/import-export/?entity=${kind === 'CUSTOMER' ? 'CUSTOMERS' : 'VENDORS'}`}>Import</Link>}
          {can('parties.export') && <Button variant="secondary" busy={busy} onClick={() => run(() => exportEntity(companyId, kind === 'CUSTOMER' ? 'CUSTOMERS' : 'VENDORS', label), 'Export ready')}>Export</Button>}
        </>} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input className="max-w-xs" placeholder="Search code, name, city, email, GSTIN" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Status filter" className="w-32" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All"
          options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Disabled' }]} />
        <span className="text-sm text-slate-500">{rows.length} record(s)</span>
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? (list.error ? null : <Spinner />) : (
        <Table>
          <thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>City</th><th className="num">Credit days</th>
            {kind === 'CUSTOMER' && <th className="num">Credit limit</th>}{kind === 'VENDOR' && <th>Type</th>}<th>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td className="font-mono">{p.code}</td>
              <td><button className="text-left font-medium text-brand hover:underline" onClick={() => setOpen(p)}>{p.name}</button></td>
              <td>{p.contact_person}<div className="text-xs text-slate-500">{[p.mobile, p.email].filter(Boolean).join(' · ')}</div></td>
              <td>{p.city}</td><td className="num">{p.credit_days}</td>
              {kind === 'CUSTOMER' && <td className="num">{money(p.credit_limit)}</td>}
              {kind === 'VENDOR' && <td>{p.party_roles.map((r) => r.role.replace('_', ' ')).join(', ')}</td>}
              <td><Badge color={p.is_active ? 'green' : 'slate'}>{p.is_active ? 'Active' : 'Disabled'}</Badge></td>
            </tr>))}
            {rows.length === 0 && <tr><td colSpan={8} className="text-slate-500">No records</td></tr>}</tbody>
        </Table>)}
      {open && <PartyDrawer key={open.id ?? 'new'} kind={kind} party={open} onClose={() => setOpen(null)}
        onSaved={async (id) => { list.reload();
          const fresh = must<PartyRow[]>(await sb().from('parties').select(COLS).eq('id', id)); if (fresh[0]) setOpen(fresh[0]); }} />}
    </div>
  );
}

function PartyDrawer({ kind, party, onClose, onSaved }: { kind: Kind; party: Partial<PartyRow>; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [tab, setTab] = useState('details');
  const tabs = [{ id: 'details', label: 'Details' },
    ...(party.id ? [{ id: 'addresses', label: 'Addresses' }, { id: 'rates', label: kind === 'CUSTOMER' ? 'Customer rates' : 'Vendor rates' },
      { id: 'portal', label: 'Portal & visibility' }, { id: 'logins', label: kind === 'CUSTOMER' ? 'Customer users' : 'Vendor users' }] : [])];
  return (
    <Modal open wide title={party.id ? `${party.name} (${party.code})` : kind === 'CUSTOMER' ? 'New customer' : 'New vendor'} onClose={onClose}>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'details' && <Details kind={kind} party={party} onSaved={onSaved} />}
      {tab === 'addresses' && party.id && <Addresses partyId={party.id} />}
      {tab === 'rates' && party.id && <Rates partyId={party.id} rateType={kind === 'CUSTOMER' ? 'SALE' : 'PURCHASE'} />}
      {tab === 'portal' && party.id && <Visibility partyId={party.id} kind={kind} />}
      {tab === 'logins' && party.id && <Logins partyId={party.id} kind={kind} defaultEmail={party.email ?? ''} />}
    </Modal>
  );
}

function Details({ kind, party, onSaved }: { kind: Kind; party: Partial<PartyRow>; onSaved: (id: string) => Promise<void> }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const defs = useCustomFields(companyId, [kind]);
  const [p, setP] = useState<Partial<PartyRow>>(party);
  const [vroles, setVroles] = useState<string[]>((party.party_roles ?? []).map((r) => r.role).filter((r) => VENDOR_ROLES.includes(r)));
  const editable = party.id ? can('parties.edit') : can('parties.create');
  const set = (k: keyof PartyRow, v: unknown) => setP((x) => ({ ...x, [k]: v }));
  const f = (k: keyof PartyRow, label: string, cls = '') => (
    <Field label={label} className={cls}><Input value={String(p[k] ?? '')} disabled={!editable} onChange={(e) => set(k, e.target.value)} /></Field>);
  const save = () => run(async () => {
    const other = (party.party_roles ?? []).map((r) => r.role).filter((r) => (kind === 'CUSTOMER' ? r !== 'CUSTOMER' : !VENDOR_ROLES.includes(r)));
    const roles = kind === 'CUSTOMER' ? [...other, 'CUSTOMER'] : [...other, ...(vroles.length ? vroles : ['SUPPLIER'])];
    const id = await rpc<string>('party_save', { p_company_id: companyId, p_id: party.id ?? null, p_payload: {
      code: p.code, name: p.name, contact_person: p.contact_person ?? '', mobile: p.mobile ?? '', phone: p.phone ?? '', email: p.email ?? '',
      gstin: p.gstin ?? '', pan: p.pan ?? '', address: p.address ?? '', city: p.city ?? '', state_code: p.state_code ?? '', pincode: p.pincode ?? '',
      credit_days: Number(p.credit_days ?? 0), credit_limit: p.credit_limit === null || p.credit_limit === undefined || String(p.credit_limit) === '' ? null : Number(p.credit_limit),
      payment_terms: p.payment_terms ?? '', notes: p.notes ?? '', is_active: p.is_active ?? true, custom: p.custom ?? {}, roles } });
    await onSaved(id);
  }, 'Saved');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {f('code', 'Code *')}{f('name', 'Name *', 'md:col-span-2')}
        {f('contact_person', 'Contact person')}{f('mobile', 'Mobile')}{f('phone', 'Phone')}
        {f('email', 'Email', 'md:col-span-2')}{f('gstin', 'GSTIN')}
        {f('address', kind === 'CUSTOMER' ? 'Billing address' : 'Address', 'md:col-span-2')}{f('city', 'City')}
        {f('state_code', 'State code')}{f('pincode', 'Pincode')}{f('pan', 'PAN')}
        <Field label="Credit days"><Input type="number" disabled={!editable} value={p.credit_days ?? 0} onChange={(e) => set('credit_days', Number(e.target.value))} /></Field>
        {kind === 'CUSTOMER' && <Field label="Credit limit"><Input type="number" disabled={!editable} value={p.credit_limit ?? ''} onChange={(e) => set('credit_limit', e.target.value)} /></Field>}
        {f('payment_terms', 'Payment terms')}
        <Field label="Notes" className="md:col-span-3"><TextArea rows={2} disabled={!editable} value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      {kind === 'VENDOR' && (
        <div className="flex flex-wrap gap-4" role="group" aria-label="Vendor type">
          {VENDOR_ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!editable} checked={vroles.includes(r)}
              onChange={(e) => setVroles(e.target.checked ? [...vroles, r] : vroles.filter((x) => x !== r))} />{r.replace('_', ' ').toLowerCase()}</label>))}
        </div>)}
      <CustomFieldsEditor defs={defs.data ?? []} value={p.custom ?? {}} onChange={(v) => set('custom', v)} disabled={!editable} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={p.is_active ?? true}
        onChange={(e) => set('is_active', e.target.checked)} />Active (disable to stop new documents)</label>
      {editable && <div className="flex justify-end"><Button busy={busy} onClick={save}>Save</Button></div>}
    </div>
  );
}

function Addresses({ partyId }: { partyId: string }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const rows = useData(async () => must<{ id: string; address_type: string; code: string; name: string | null; address: string | null; city: string | null;
    state_code: string | null; gstin: string | null; is_active: boolean }[]>(await sb().from('party_addresses')
    .select('id, address_type, code, name, address, city, state_code, gstin, is_active').eq('party_id', partyId).order('address_type').order('code')), [partyId]);
  const [n, setN] = useState({ address_type: 'SHIP_TO', code: '', name: '', address: '', city: '', state_code: '', gstin: '' });
  return (
    <div className="space-y-3">
      <Table><thead><tr><th>Type</th><th>Code</th><th>Name / address</th><th>City</th><th>GSTIN</th><th>Status</th><th /></tr></thead>
        <tbody>{(rows.data ?? []).map((a) => (
          <tr key={a.id}><td>{a.address_type === 'BILLING' ? 'Billing' : 'Shipping'}</td><td>{a.code}</td><td>{a.name}<div className="text-xs text-slate-500">{a.address}</div></td>
            <td>{a.city}</td><td>{a.gstin}</td><td><Badge color={a.is_active ? 'green' : 'slate'}>{a.is_active ? 'Active' : 'Inactive'}</Badge></td>
            <td>{can('parties.edit') && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
              must(await sb().from('party_addresses').update({ is_active: !a.is_active }).eq('id', a.id)); rows.reload(); }, 'Saved')}>{a.is_active ? 'Deactivate' : 'Activate'}</Button>}</td></tr>))}
          {rows.data?.length === 0 && <tr><td colSpan={7} className="text-slate-500">No extra addresses</td></tr>}</tbody></Table>
      {can('parties.edit') && (
        <div className="grid items-end gap-2 md:grid-cols-4">
          <Field label="Type"><Select value={n.address_type} onChange={(e) => setN({ ...n, address_type: e.target.value })}
            options={[{ value: 'SHIP_TO', label: 'Shipping' }, { value: 'BILLING', label: 'Billing' }]} /></Field>
          <Field label="Address code"><Input value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} /></Field>
          <Field label="Name"><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
          <Field label="City"><Input value={n.city} onChange={(e) => setN({ ...n, city: e.target.value })} /></Field>
          <Field label="Address" className="md:col-span-2"><Input value={n.address} onChange={(e) => setN({ ...n, address: e.target.value })} /></Field>
          <Field label="State code"><Input value={n.state_code} onChange={(e) => setN({ ...n, state_code: e.target.value })} /></Field>
          <Button busy={busy} onClick={() => run(async () => {
            if (!n.code.trim()) throw new Error('Address code is required');
            must(await sb().from('party_addresses').insert({ party_id: partyId, ...n, code: n.code.trim().toUpperCase(), gstin: n.gstin || null }));
            setN({ ...n, code: '', name: '', address: '', city: '' }); rows.reload(); }, 'Address added')}>Add address</Button>
        </div>)}
    </div>
  );
}

function Rates({ partyId, rateType }: { partyId: string; rateType: 'SALE' | 'PURCHASE' }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const items = useItems(companyId);
  const { busy, run } = useAction();
  const [n, setN] = useState({ item_id: '', rate: '', from: new Date().toISOString().slice(0, 10) });
  // RLS hides these rows unless the user has the sales / purchase rate right
  const rates = useData(async () => must<{ id: string; rate: number; effective_from: string; item_id: string; items: { code: string; name: string } | null }[]>(
    await sb().from('party_item_rates').select('id, rate, effective_from, item_id, items(code, name)').eq('party_id', partyId).eq('rate_type', rateType)
      .order('effective_from', { ascending: false })), [partyId, rateType]);
  const visible = can(rateType === 'SALE' ? 'items.view_sale_rate' : 'items.view_purchase_rate');
  if (!visible) return <p className="text-sm text-slate-500">You are not allowed to see {rateType === 'SALE' ? 'sales' : 'purchase'} rates.</p>;
  const editable = can('items.edit_rate') && can('rates.create');
  const base = (id: string) => { const i = items.data?.find((x) => x.id === id); return rateType === 'SALE' ? i?.sale_price : i?.purchase_price; };
  return (
    <div className="space-y-3">
      <Table><thead><tr><th>Item</th><th className="num">Item rate</th><th className="num">Special rate</th><th>From</th><th /></tr></thead>
        <tbody>{(rates.data ?? []).map((r) => (
          <tr key={r.id}><td>{r.items?.name}<div className="text-xs text-slate-500">{r.items?.code}</div></td>
            <td className="num">{money(base(r.item_id))}</td><td className="num font-semibold">{money(r.rate)}</td><td>{date(r.effective_from)}</td>
            <td>{can('items.edit_rate') && can('rates.delete') && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
              must(await sb().from('party_item_rates').delete().eq('id', r.id)); rates.reload(); }, 'Rate removed')}>Remove</Button>}</td></tr>))}
          {rates.data?.length === 0 && <tr><td colSpan={5} className="text-slate-500">No special rates</td></tr>}</tbody></Table>
      {editable && (
        <div className="grid items-end gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
          <Field label="Item"><Select value={n.item_id} onChange={(e) => setN({ ...n, item_id: e.target.value })} placeholder="Choose"
            options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.code} — ${i.name}` }))} /></Field>
          <Field label="Rate"><Input type="number" step="0.01" value={n.rate} onChange={(e) => setN({ ...n, rate: e.target.value })} /></Field>
          <Field label="Effective from"><Input type="date" value={n.from} onChange={(e) => setN({ ...n, from: e.target.value })} /></Field>
          <Button busy={busy} onClick={() => run(async () => {
            if (!n.item_id || n.rate === '' || !(Number(n.rate) >= 0)) throw new Error('Choose item and rate');
            must(await sb().from('party_item_rates').insert({ company_id: companyId, rate_type: rateType, party_id: partyId, item_id: n.item_id,
              rate: Number(n.rate), effective_from: n.from }));
            setN({ ...n, item_id: '', rate: '' }); rates.reload(); }, 'Rate saved')}>Add rate</Button>
        </div>)}
    </div>
  );
}

type Tri = '' | 'true' | 'false';
function Visibility({ partyId, kind }: { partyId: string; kind: Kind }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const cur = useData(async () => must<Record<string, unknown>[]>(await sb().from('party_settings').select('*').eq('party_id', partyId)), [partyId]);
  const [v, setV] = useState<Record<string, string> | null>(null);
  const row = cur.data?.[0] ?? {};
  const val = (k: string) => v?.[k] ?? (row[k] === null || row[k] === undefined ? '' : String(row[k]));
  const set = (k: string, x: string) => setV({ ...(v ?? {}), [k]: x });
  const tri = (k: string, l: string) => (
    <Field label={l}><Select value={val(k)} onChange={(e) => set(k, e.target.value as Tri)}
      options={[{ value: '', label: 'Use company setting' }, { value: 'true', label: 'Visible / ON' }, { value: 'false', label: 'Hidden / OFF' }]} /></Field>);
  const editable = can('portal.edit');
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">What this {kind === 'CUSTOMER' ? 'customer' : 'vendor'} sees in the portal: this override → company setting.
        The role of each login (Customer / Vendor users tab) can narrow it further. Enforced by the database.</p>
      <fieldset disabled={!editable} className="grid gap-3 md:grid-cols-2">
        {kind === 'CUSTOMER' && <>
          <Field label="Stock visibility"><Select value={val('stock_visibility')} onChange={(e) => set('stock_visibility', e.target.value)} options={[
            { value: '', label: 'Use company setting' }, { value: 'HIDDEN', label: 'Hidden' }, { value: 'EXACT_QUANTITY', label: 'Exact quantity' },
            { value: 'AVAILABLE_STATUS', label: 'In stock / Low / Out' }, { value: 'AVAILABLE_TO_PROMISE', label: 'Available to promise' }]} /></Field>
          {tri('rate_visible', 'Rates')}
          {tri('quote_price_enabled', 'May quote a price on POs')}
          {tri('outstanding_visible', 'Credit / outstanding')}
        </>}
        {kind === 'VENDOR' && tri('payment_visible', 'Payments')}
        {tri('email_enabled', 'Automatic emails')}
        {tri('payment_reminder_enabled', 'Payment reminders')}
      </fieldset>
      <p className="text-xs text-slate-500">Documents: each uploaded document has its own “visible to party” switch (Documents).</p>
      {editable && <div className="flex justify-end"><Button busy={busy} onClick={() => run(async () => {
        const b = (k: string) => (val(k) === '' ? null : val(k) === 'true');
        const payload: Record<string, unknown> = { party_id: partyId, email_enabled: b('email_enabled'), payment_reminder_enabled: b('payment_reminder_enabled') };
        if (kind === 'CUSTOMER') Object.assign(payload, { stock_visibility: val('stock_visibility') || null, rate_visible: b('rate_visible'),
          quote_price_enabled: b('quote_price_enabled'), outstanding_visible: b('outstanding_visible') });
        else payload.payment_visible = b('payment_visible');
        must(await sb().from('party_settings').upsert(payload));
        setV(null); cur.reload();
      }, 'Visibility saved')}>Save visibility</Button></div>}
    </div>
  );
}

function Logins({ partyId, kind, defaultEmail }: { partyId: string; kind: Kind; defaultEmail: string }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const users = useData(async () => must<{ id: string; email: string; display_name: string | null; is_active: boolean; user_id: string | null;
    claimed_at: string | null; last_login_at: string | null; role_id: string | null }[]>(
    await sb().from('portal_users').select('id, email, display_name, is_active, user_id, claimed_at, last_login_at, role_id')
      .eq('party_id', partyId).eq('kind', kind).order('invited_at')), [partyId, kind]);
  const roles = useData(async () => must<{ id: string; name: string; is_active: boolean }[]>(await sb().from('roles').select('id, name, is_active')
    .eq('company_id', companyId).eq('kind', kind === 'CUSTOMER' ? 'CUSTOMER_PORTAL' : 'VENDOR_PORTAL').order('sort_order')), [companyId, kind]);
  const [n, setN] = useState({ email: defaultEmail.split(/[,;\s]+/)[0] ?? '', name: '' });
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Each login sees only this {kind === 'CUSTOMER' ? 'customer' : 'vendor'}&apos;s own data. Its portal role decides which features it may use
        (configure roles in Roles &amp; permissions → portal roles).</p>
      <Table><thead><tr><th>Login</th><th>Portal role</th><th>Status</th><th>Last login</th><th /></tr></thead>
        <tbody>{(users.data ?? []).map((u) => (
          <tr key={u.id}><td>{u.email}{u.display_name && <div className="text-xs text-slate-500">{u.display_name}</div>}</td>
            <td><Select aria-label={`Portal role of ${u.email}`} disabled={!can('portal.edit')} value={u.role_id ?? ''} className="w-44"
              onChange={(e) => run(async () => { await rpc('portal_user_set_role', { p_portal_user_id: u.id, p_role_id: e.target.value }); users.reload(); }, 'Portal role saved')}
              options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name + (r.is_active ? '' : ' (disabled)') }))} /></td>
            <td><Badge color={u.is_active ? 'green' : 'slate'}>{u.is_active ? (u.claimed_at ? 'Active' : 'Invited') : 'Disabled'}</Badge></td>
            <td>{dateTime(u.last_login_at)}</td>
            <td className="space-x-1 whitespace-nowrap">
              {u.user_id && can('users.reset_password') && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
                const r = await adminUsers<{ email: string; temporary_password: string }>({ action: 'reset_password', company_id: companyId, user_id: u.user_id });
                setTemp({ email: r.email, password: r.temporary_password }); }, 'Password reset')}>Reset password</Button>}
              {(can('portal.edit') || can('users.disable')) && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
                if (u.user_id && can('users.disable')) await adminUsers({ action: 'set_status', company_id: companyId, user_id: u.user_id, active: !u.is_active });
                else await rpc('portal_user_set_active', { p_portal_user_id: u.id, p_active: !u.is_active });
                users.reload(); }, u.is_active ? 'Login disabled' : 'Login enabled')}>{u.is_active ? 'Disable' : 'Enable'}</Button>}
            </td></tr>))}
          {users.data?.length === 0 && <tr><td colSpan={5} className="text-slate-500">No logins</td></tr>}</tbody></Table>
      {can('users.create') && can('portal.create') && (
        <div className="grid items-end gap-2 md:grid-cols-[1.4fr_1fr_auto_auto]">
          <Field label="Login email"><Input type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></Field>
          <Field label="Name"><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
          <Button busy={busy} onClick={() => run(async () => {
            const r = await adminUsers<{ email: string; temporary_password: string | null }>({ action: 'create', company_id: companyId,
              payload: { kind, email: n.email.trim(), full_name: n.name.trim(), party_id: partyId } });
            if (r.temporary_password) setTemp({ email: r.email, password: r.temporary_password });
            setN({ email: '', name: '' }); users.reload(); }, 'Login created')}>Create login</Button>
          <Button variant="secondary" busy={busy} onClick={() => run(async () => {
            await rpc('portal_invite', { p_party_id: partyId, p_kind: kind, p_email: n.email.trim(), p_display_name: n.name || null });
            setN({ email: '', name: '' }); users.reload(); }, 'Invited — the person signs in with an email code')}>Invite by email</Button>
        </div>)}
      <TempPasswordModal value={temp} onClose={() => setTemp(null)} />
    </div>
  );
}
