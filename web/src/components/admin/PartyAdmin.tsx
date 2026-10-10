'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useItems } from '@/lib/masters';
import { date, dateTime, money } from '@/lib/format';
import { adminUsers } from '@/lib/admin';
import { downloadRows, exportEntity } from '@/lib/spreadsheet';
import { useHotkeys } from '@/lib/hotkeys';
import { PAGE_SIZE, Pager, SortTh, ilikeTerm, type Sort } from '@/components/ListTools';
import { DocumentsPanel } from '@/components/Documents';
import { AuditTrail } from '@/components/AuditTrail';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, TextArea, Toggle, useAction, useToast } from '@/components/ui';
import { CustomFieldsEditor, useCustomFields } from './CustomFields';
import { TempPasswordModal } from './widgets';

type Kind = 'CUSTOMER' | 'VENDOR';
const VENDOR_ROLES = ['SUPPLIER', 'JOB_WORKER', 'CUTTER'];
interface PartyRow { id: string; code: string; name: string; contact_person: string | null; mobile: string | null; phone: string | null;
  email: string | null; gstin: string | null; pan: string | null; address: string | null; city: string | null; state_code: string | null;
  pincode: string | null; credit_days: number; credit_limit: number | null; payment_terms: string | null; notes: string | null;
  is_active: boolean; custom: Record<string, unknown>; party_roles: { role: string }[];
  legal_name: string | null; party_type_id: string | null; status: 'ACTIVE' | 'ON_HOLD' | 'DISABLED' }
const COLS = 'id, code, name, contact_person, mobile, phone, email, gstin, pan, address, city, state_code, pincode, credit_days, credit_limit, '
  + 'payment_terms, notes, is_active, custom, party_roles(role), legal_name, party_type_id, status';
const STATUS = [{ value: 'ACTIVE', label: 'Active' }, { value: 'ON_HOLD', label: 'On hold (no new orders)' }, { value: 'DISABLED', label: 'Disabled' }];
const statusColor = (s: string) => (s === 'ACTIVE' ? 'green' : s === 'ON_HOLD' ? 'amber' : 'slate');

/** Right of this master: customers.* or vendors.* (parties.* is the umbrella over both). */
export function usePartyRight(kind: Kind) {
  const { can } = useSession();
  const base = kind === 'CUSTOMER' ? 'customers.' : 'vendors.';
  return (action: string) => can(base + action) || can('parties.' + action);
}

/** Customer or vendor master (Admin control center). Rights: customers.* / vendors.*, rates.*, portal.* — enforced by the database. */
export function PartyAdmin({ kind }: { kind: Kind }) {
  const companyId = useCompanyId();
  const right = usePartyRight(kind);
  const { busy, run } = useAction();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [sort, setSort] = useState<Sort>({ col: 'name', asc: true });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Partial<PartyRow> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const list = useData(async () => {
    let qy = sb().from('parties').select(COLS, { count: 'exact' }).eq('company_id', companyId).eq('is_deleted', false)
      .eq(kind === 'CUSTOMER' ? 'is_customer' : 'is_vendor', true);
    if (q.trim()) { const t = ilikeTerm(q); qy = qy.or(`code.ilike.${t},name.ilike.${t},city.ilike.${t},email.ilike.${t},mobile.ilike.${t},gstin.ilike.${t}`); }
    if (status) qy = qy.eq('status', status);
    const res = await qy.order(sort.col, { ascending: sort.asc }).order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    return { rows: must<PartyRow[]>(res), total: res.count ?? 0 };
  }, [companyId, kind, q, status, sort.col, sort.asc, page]);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);
  const blankParty = (): Partial<PartyRow> => ({ is_active: true, status: 'ACTIVE', credit_days: 0, custom: {},
    party_roles: [{ role: kind === 'CUSTOMER' ? 'CUSTOMER' : 'SUPPLIER' }] });
  useHotkeys({ '/': () => searchRef.current?.focus(), n: right('create') ? () => setOpen(blankParty()) : undefined }, !open);
  const label = kind === 'CUSTOMER' ? 'Customers' : 'Vendors';
  const rows = list.data?.rows ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = (active: boolean) => run(async () => {
    if (!window.confirm(`${active ? 'Enable' : 'Disable'} ${selected.size} ${label.toLowerCase()}?`)) return;
    await rpc('master_set_active', { p_company_id: companyId, p_kind: 'PARTY', p_ids: [...selected], p_active: active });
    setSelected(new Set()); list.reload();
  }, active ? `${label} enabled` : `${label} disabled`);

  return (
    <div>
      <PageHeader title={label} subtitle={(kind === 'CUSTOMER'
        ? 'Customer master, special rates, opening balance, documents, portal visibility and customer logins.'
        : 'Vendor master (suppliers, job workers, cutters), purchase rates, opening balance, documents and vendor logins.')
        + ' Shortcuts: / search · N new · Esc close · Ctrl+S save'}
        actions={<>
          {right('create') && <Button onClick={() => setOpen(blankParty())}>New {kind === 'CUSTOMER' ? 'customer' : 'vendor'}</Button>}
          {right('import') && <Link className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50"
            href={`/erp/admin/import-export/?entity=${kind === 'CUSTOMER' ? 'CUSTOMERS' : 'VENDORS'}`}>Import</Link>}
          {right('export') && <Button variant="secondary" busy={busy} onClick={() => run(() => exportEntity(companyId, kind === 'CUSTOMER' ? 'CUSTOMERS' : 'VENDORS', label), 'Export ready')}>Export</Button>}
        </>} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input ref={searchRef} className="max-w-xs" aria-label={`Search ${label.toLowerCase()}`} placeholder="Search code, name, city, email, GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Status filter" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} placeholder="All"
          options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ON_HOLD', label: 'On hold' }, { value: 'DISABLED', label: 'Disabled' }]} />
        {selected.size > 0 && <div className="flex items-center gap-2 rounded-md bg-brand-light px-2 py-1 text-sm" data-testid="bulk-bar">
          {selected.size} selected
          {right('edit') && <><Button variant="secondary" busy={busy} onClick={() => bulk(true)}>Enable</Button>
            <Button variant="secondary" busy={busy} onClick={() => bulk(false)}>Disable</Button></>}
          {right('export') && <Button variant="secondary" busy={busy} onClick={() => run(async () => {
            const chosen = must<PartyRow[]>(await sb().from('parties').select(COLS).in('id', [...selected]));
            await downloadRows(`${label.toLowerCase()}-selected`, ['code', 'name', 'legal_name', 'status', 'contact_person', 'mobile', 'email', 'city', 'gstin'],
              chosen as unknown as Record<string, unknown>[]);
          }, 'Export ready')}>Export selected</Button>}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button></div>}
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? (list.error ? null : <Spinner />) : (
        <>
          <Table>
            <thead><tr>
              <th><input type="checkbox" aria-label="Select page" checked={allOnPage}
                onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n; })} /></th>
              <SortTh col="code" sort={sort} onSort={(x) => { setSort(x); setPage(0); }}>Code</SortTh>
              <SortTh col="name" sort={sort} onSort={(x) => { setSort(x); setPage(0); }}>Name</SortTh>
              <th>Contact</th><SortTh col="city" sort={sort} onSort={(x) => { setSort(x); setPage(0); }}>City</SortTh><th className="num">Credit days</th>
              {kind === 'CUSTOMER' && <th className="num">Credit limit</th>}{kind === 'VENDOR' && <th>Type</th>}<th>Status</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} data-testid={`party-row-${p.code}`}>
                <td><input type="checkbox" aria-label={`Select ${p.code}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                <td className="font-mono">{p.code}</td>
                <td><button className="text-left font-medium text-brand hover:underline" onClick={() => setOpen(p)}>{p.name}</button></td>
                <td>{p.contact_person}<div className="text-xs text-slate-500">{[p.mobile, p.email].filter(Boolean).join(' · ')}</div></td>
                <td>{p.city}</td><td className="num">{p.credit_days}</td>
                {kind === 'CUSTOMER' && <td className="num">{money(p.credit_limit)}</td>}
                {kind === 'VENDOR' && <td>{p.party_roles.map((r) => r.role.replace('_', ' ')).join(', ')}</td>}
                <td><Badge color={statusColor(p.status)}>{p.status}</Badge></td>
              </tr>))}
              {rows.length === 0 && <tr><td colSpan={9} className="text-slate-500">No records</td></tr>}</tbody>
          </Table>
          <Pager page={page} total={list.data.total} onPage={setPage} />
        </>)}
      {open && <PartyDrawer key={open.id ?? 'new'} kind={kind} party={open} onClose={() => setOpen(null)}
        onSaved={async (id) => { list.reload();
          const fresh = must<PartyRow[]>(await sb().from('parties').select(COLS).eq('id', id)); if (fresh[0]) setOpen(fresh[0]); }}
        onDeleted={() => { setOpen(null); list.reload(); }} />}
    </div>
  );
}

function PartyDrawer({ kind, party, onClose, onSaved, onDeleted }: { kind: Kind; party: Partial<PartyRow>; onClose: () => void;
  onSaved: (id: string) => Promise<void>; onDeleted: () => void }) {
  const companyId = useCompanyId();
  const [tab, setTab] = useState('details');
  const tabs = [{ id: 'details', label: 'Details' },
    ...(party.id ? [{ id: 'addresses', label: 'Addresses' }, { id: 'rates', label: kind === 'CUSTOMER' ? 'Customer rates' : 'Vendor rates' },
      { id: 'opening', label: 'Opening balance' }, { id: 'documents', label: 'Documents' },
      { id: 'portal', label: 'Portal & visibility' }, { id: 'logins', label: kind === 'CUSTOMER' ? 'Customer users' : 'Vendor users' },
      { id: 'audit', label: 'Audit' }] : [])];
  return (
    <Modal open wide title={party.id ? `${party.name} (${party.code})` : kind === 'CUSTOMER' ? 'New customer' : 'New vendor'} onClose={onClose}>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'details' && <Details kind={kind} party={party} onSaved={onSaved} onDeleted={onDeleted} />}
      {tab === 'addresses' && party.id && <Addresses partyId={party.id} kind={kind} />}
      {tab === 'rates' && party.id && <Rates partyId={party.id} rateType={kind === 'CUSTOMER' ? 'SALE' : 'PURCHASE'} />}
      {tab === 'opening' && party.id && <OpeningBalance partyId={party.id} kind={kind} />}
      {tab === 'documents' && party.id && <DocumentsPanel companyId={companyId} entityType="party" entityId={party.id} />}
      {tab === 'portal' && party.id && <Visibility partyId={party.id} kind={kind} />}
      {tab === 'logins' && party.id && <Logins partyId={party.id} kind={kind} defaultEmail={party.email ?? ''} />}
      {tab === 'audit' && party.id && <AuditTrail companyId={companyId} table="parties" rowId={party.id} />}
    </Modal>
  );
}

function Details({ kind, party, onSaved, onDeleted }: { kind: Kind; party: Partial<PartyRow>; onSaved: (id: string) => Promise<void>; onDeleted: () => void }) {
  const companyId = useCompanyId();
  const right = usePartyRight(kind);
  const { busy, run } = useAction();
  const types = useData(async () => must<{ id: string; name: string; applies_to: string }[]>(await sb().from('party_types').select('id, name, applies_to')
    .eq('company_id', companyId).eq('is_active', true).order('name')), [companyId]);
  const defs = useCustomFields(companyId, [kind]);
  const [p, setP] = useState<Partial<PartyRow>>(party);
  const [vroles, setVroles] = useState<string[]>((party.party_roles ?? []).map((r) => r.role).filter((r) => VENDOR_ROLES.includes(r)));
  const editable = party.id ? right('edit') : right('create');
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
      payment_terms: p.payment_terms ?? '', notes: p.notes ?? '', status: p.status ?? 'ACTIVE', custom: p.custom ?? {}, roles,
      legal_name: p.legal_name ?? '', party_type_id: p.party_type_id ?? null } });
    await onSaved(id);
  }, 'Saved');
  useHotkeys({ 'mod+s': () => { if (editable) save(); } });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {f('code', party.id ? 'Code *' : 'Code (empty = next automatic code)')}{f('name', 'Name *', 'md:col-span-2')}
        {f('legal_name', 'Legal name', 'md:col-span-2')}
        <Field label="Type"><Select aria-label="Party type" disabled={!editable} value={p.party_type_id ?? ''} placeholder="—"
          options={(types.data ?? []).filter((t) => t.applies_to === 'BOTH' || t.applies_to === kind).map((t) => ({ value: t.id, label: t.name }))}
          onChange={(e) => set('party_type_id', e.target.value || null)} /></Field>
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
      <Field label="Status" hint="On hold: no new orders; existing documents continue. Disabled: not offered any more.">
        <Select aria-label="Status" className="max-w-xs" disabled={!editable} value={p.status ?? 'ACTIVE'} options={STATUS} onChange={(e) => set('status', e.target.value)} /></Field>
      <div className="flex justify-between gap-2">
        {party.id && right('delete') ? <Button variant="danger" busy={busy} onClick={() => run(async () => {
          if (!window.confirm(`Delete ${party.name}? Only possible without documents, rates or balances — otherwise disable it.`)) return;
          await rpc('master_delete', { p_company_id: companyId, p_kind: 'PARTY', p_id: party.id }); onDeleted(); }, 'Deleted')}>Delete</Button> : <span />}
        {editable && <Button busy={busy} onClick={save}>Save</Button>}
      </div>
    </div>
  );
}

function Addresses({ partyId, kind }: { partyId: string; kind: Kind }) {
  const right = usePartyRight(kind);
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
            <td>{right('edit') && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
              must(await sb().from('party_addresses').update({ is_active: !a.is_active }).eq('id', a.id)); rows.reload(); }, 'Saved')}>{a.is_active ? 'Deactivate' : 'Activate'}</Button>}</td></tr>))}
          {rows.data?.length === 0 && <tr><td colSpan={7} className="text-slate-500">No extra addresses</td></tr>}</tbody></Table>
      {right('edit') && (
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
  const toast = useToast();
  const items = useItems(companyId);
  const { busy, run } = useAction();
  const [n, setN] = useState({ item_id: '', rate: '', from: new Date().toISOString().slice(0, 10) });
  // RLS hides these rows unless the user has the sales / purchase rate right
  const rates = useData(async () => must<{ id: string; rate: number; effective_from: string; item_id: string; is_active: boolean; items: { code: string; name: string } | null }[]>(
    await sb().from('party_item_rates').select('id, rate, effective_from, item_id, is_active, items(code, name)').eq('party_id', partyId).eq('rate_type', rateType)
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
            <td className="num">{money(base(r.item_id))}</td><td className="num font-semibold">{money(r.rate)}</td>
            <td>{date(r.effective_from)} {!r.is_active && <Badge color="slate">Inactive</Badge>}</td>
            <td className="whitespace-nowrap">{can('items.edit_rate') && can('rates.edit') && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
              must(await sb().from('party_item_rates').update({ is_active: !r.is_active }).eq('id', r.id)); rates.reload(); },
              r.is_active ? 'Rate deactivated — not used for new documents' : 'Rate activated')}>{r.is_active ? 'Deactivate' : 'Activate'}</Button>}
              {can('items.edit_rate') && can('rates.delete') && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
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
            const r = await rpc<{ status: string }>('party_rate_save', { p_company_id: companyId, p_payload: { rate_type: rateType, party_id: partyId,
              item_id: n.item_id, rate: Number(n.rate), effective_from: n.from } });
            if (r.status === 'PENDING_APPROVAL') toast.ok('Rate sent for approval');
            setN({ ...n, item_id: '', rate: '' }); rates.reload(); }, 'Rate saved')}>Add rate</Button>
        </div>)}
    </div>
  );
}

interface Opening { id: string; side: string; dr_cr: string; amount: number; as_of: string; status: string; remarks: string | null;
  reverse_reason: string | null; created_at: string; reversed_at: string | null }

/**
 * Opening balance (D5): one balanced journal per party and side (party line on
 * Sundry Debtors / Creditors against Opening Balance Adjustment). A posted
 * balance is never edited: it is reversed with a reason and posted again.
 */
function OpeningBalance({ partyId, kind }: { partyId: string; kind: Kind }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const side = kind === 'CUSTOMER' ? 'RECEIVABLE' : 'PAYABLE';
  const normal = kind === 'CUSTOMER' ? 'DR' : 'CR';
  const rows = useData(async () => must<Opening[]>(await sb().from('party_opening_balances')
    .select('id, side, dr_cr, amount, as_of, status, remarks, reverse_reason, created_at, reversed_at').eq('party_id', partyId).eq('side', side)
    .order('created_at', { ascending: false })), [partyId, side]);
  const [n, setN] = useState({ dr_cr: normal, amount: '', as_of: '', remarks: '', confirm: false });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [reverse, setReverse] = useState<Opening | null>(null);
  const [reason, setReason] = useState('');
  const posted = rows.data?.find((r) => r.status === 'POSTED');
  const canPost = can('accounts.opening_balance');
  return (
    <div className="space-y-3">
      <ErrorBox error={rows.error} />
      <Table><thead><tr><th>As of</th><th>Dr / Cr</th><th className="num">Amount</th><th>Status</th><th>Remarks</th><th /></tr></thead>
        <tbody>{(rows.data ?? []).map((r) => (
          <tr key={r.id} data-testid={`opening-${r.status}`}><td>{date(r.as_of)}</td><td>{r.dr_cr === 'DR' ? 'Debit' : 'Credit'}</td><td className="num">{money(r.amount)}</td>
            <td><Badge color={r.status === 'POSTED' ? 'green' : 'slate'}>{r.status}</Badge></td>
            <td className="text-xs">{r.remarks}{r.reverse_reason ? ` · reversed: ${r.reverse_reason}` : ''}</td>
            <td>{canPost && r.status === 'POSTED' && <Button variant="ghost" onClick={() => { setReverse(r); setReason(''); }}>Reverse</Button>}</td></tr>))}
          {rows.data?.length === 0 && <tr><td colSpan={6} className="text-slate-500">No opening balance</td></tr>}</tbody></Table>
      {canPost && !posted && (
        <Card title="Post opening balance">
          <div className="grid items-end gap-3 md:grid-cols-4">
            <Field label="Debit / credit"><Select aria-label="Debit or credit" value={n.dr_cr} onChange={(e) => setN({ ...n, dr_cr: e.target.value, confirm: false })}
              options={[{ value: 'DR', label: kind === 'CUSTOMER' ? 'Debit — customer owes us' : 'Debit — advance paid to vendor' },
                        { value: 'CR', label: kind === 'CUSTOMER' ? 'Credit — advance from customer' : 'Credit — we owe the vendor' }]} /></Field>
            <Field label="Amount"><Input aria-label="Opening amount" type="number" min="0.01" step="0.01" value={n.amount} onChange={(e) => setN({ ...n, amount: e.target.value })} /></Field>
            <Field label="As of"><Input aria-label="As of" type="date" value={n.as_of} onChange={(e) => setN({ ...n, as_of: e.target.value })} /></Field>
            <Field label="Remarks"><Input aria-label="Opening remarks" value={n.remarks} onChange={(e) => setN({ ...n, remarks: e.target.value })} /></Field>
          </div>
          {n.dr_cr !== normal && <div className="mt-2"><Toggle label="Confirm: this is an advance / opposite balance" checked={n.confirm} onChange={(v) => setN({ ...n, confirm: v })} /></div>}
          <div className="mt-3 flex justify-end"><Button busy={busy} disabled={!(Number(n.amount) > 0) || !n.as_of || (n.dr_cr !== normal && !n.confirm)}
            onClick={() => run(async () => {
              await rpc('opening_balance_post', { p_company_id: companyId, p_payload: { party_id: partyId, side, dr_cr: n.dr_cr, amount: Number(n.amount),
                as_of: n.as_of, remarks: n.remarks || null, confirm_opposite: n.confirm, idempotency_key: key } });
              setKey(crypto.randomUUID()); setN({ dr_cr: normal, amount: '', as_of: '', remarks: '', confirm: false }); rows.reload();
            }, 'Opening balance posted')}>Post</Button></div>
        </Card>)}
      {reverse && <Modal open title="Reverse opening balance" onClose={() => setReverse(null)}>
        <p className="mb-2 text-sm">{money(reverse.amount)} {reverse.dr_cr} as of {date(reverse.as_of)}. A reversal journal is posted; then a corrected balance can be posted.</p>
        <Field label="Reason (required)"><Input aria-label="Reversal reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setReverse(null)}>Cancel</Button>
          <Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={() => run(async () => {
            await rpc('opening_balance_reverse', { p_id: reverse.id, p_reason: reason }); setReverse(null); rows.reload(); }, 'Reversed')}>Reverse</Button></div>
      </Modal>}
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
