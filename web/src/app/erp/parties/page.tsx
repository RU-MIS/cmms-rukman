'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useItems } from '@/lib/masters';
import { date, dateTime, money } from '@/lib/format';
import { DocumentsPanel } from '@/components/Documents';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Toggle, useAction } from '@/components/ui';

interface Party { id: string; code: string; name: string; email: string | null; mobile: string | null; gstin: string | null; address: string | null;
  city: string | null; credit_days: number; is_active: boolean; party_roles: { role: string }[] }
const ROLES = ['CUSTOMER', 'SUPPLIER', 'JOB_WORKER', 'CUTTER', 'TRANSPORTER', 'WORKER'];

export default function PartiesPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const [role, setRole] = useState('CUSTOMER');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Partial<Party> | null>(null);
  const list = useData(async () => must<Party[]>(await sb().from('parties').select('*, party_roles(role)').eq('company_id', companyId)
    .eq('is_deleted', false).order('name')), [companyId]);
  const rows = (list.data ?? []).filter((p) => (!role || p.party_roles.some((r) => r.role === role))
    && (!search || `${p.code} ${p.name} ${p.email ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  return (
    <div>
      <PageHeader title="Customers & vendors" subtitle="Party master, portal access, visibility overrides and party-specific prices"
        actions={can('parties.create') && <Button onClick={() => setSel({ is_active: true, credit_days: 0, party_roles: [{ role: role || 'CUSTOMER' }] })}>New party</Button>} />
      <div className="mb-3 flex flex-wrap gap-3">
        <Select aria-label="Role" className="max-w-[200px]" value={role} onChange={(e) => setRole(e.target.value)} placeholder="All roles"
          options={ROLES.map((r) => ({ value: r, label: r.replace('_', ' ') }))} />
        <Input className="max-w-xs" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? <Spinner /> : (
        <Table><thead><tr><th>Code</th><th>Name</th><th>Roles</th><th>Email</th><th className="num">Credit days</th><th>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}><td className="font-mono">{p.code}</td><td><button className="font-medium text-brand hover:underline" onClick={() => setSel(p)}>{p.name}</button></td>
              <td className="space-x-1">{p.party_roles.map((r) => <Badge key={r.role} color="blue">{r.role}</Badge>)}</td><td>{p.email}</td>
              <td className="num">{p.credit_days}</td><td><Badge color={p.is_active ? 'green' : 'slate'}>{p.is_active ? 'Active' : 'Inactive'}</Badge></td></tr>))}
            {rows.length === 0 && <tr><td colSpan={6} className="text-slate-500">No parties</td></tr>}</tbody></Table>
      )}
      {sel && <PartyModal party={sel} onClose={() => setSel(null)} onSaved={(p) => { list.reload(); setSel(p); }} />}
    </div>
  );
}

function PartyModal({ party, onClose, onSaved }: { party: Partial<Party>; onClose: () => void; onSaved: (p: Party) => void }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const [tab, setTab] = useState('details');
  const [p, setP] = useState(party);
  const [roles, setRoles] = useState<string[]>((party.party_roles ?? []).map((r) => r.role));
  const isCustomer = roles.includes('CUSTOMER');
  const isVendor = roles.some((r) => ['SUPPLIER', 'JOB_WORKER', 'CUTTER'].includes(r));

  const save = () => run(async () => {
    if (!p.code?.trim() || !p.name?.trim()) throw new Error('Code and name are required');
    const row = { code: p.code.trim(), name: p.name.trim(), email: p.email?.trim() || null, mobile: p.mobile || null, gstin: p.gstin || null,
      address: p.address || null, city: p.city || null, credit_days: Number(p.credit_days ?? 0), is_active: p.is_active ?? true };
    const saved = p.id ? must<Party>(await sb().from('parties').update(row).eq('id', p.id).select('*, party_roles(role)').single())
      : must<Party>(await sb().from('parties').insert({ ...row, company_id: companyId }).select('*, party_roles(role)').single());
    const have = saved.party_roles.map((r) => r.role);
    for (const r of roles.filter((x) => !have.includes(x))) must(await sb().from('party_roles').insert({ party_id: saved.id, role: r }));
    for (const r of have.filter((x) => !roles.includes(x))) must(await sb().from('party_roles').delete().eq('party_id', saved.id).eq('role', r));
    onSaved({ ...saved, party_roles: roles.map((role) => ({ role })) });
  }, 'Saved');

  const tabs = [{ id: 'details', label: 'Details' }];
  if (p.id) {
    if (isCustomer || isVendor) tabs.push({ id: 'portal', label: 'Portal access' }, { id: 'overrides', label: 'Visibility & email' }, { id: 'prices', label: 'Prices' });
    tabs.push({ id: 'docs', label: 'Documents' });
  }
  return (
    <Modal open wide title={p.id ? p.name ?? '' : 'New party'} onClose={onClose}>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'details' && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Code *"><Input value={p.code ?? ''} onChange={(e) => setP({ ...p, code: e.target.value })} /></Field>
            <Field label="Name *" className="md:col-span-2"><Input value={p.name ?? ''} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="Email(s)" hint="Several addresses: separate with commas"><Input value={p.email ?? ''} onChange={(e) => setP({ ...p, email: e.target.value })} /></Field>
            <Field label="Mobile"><Input value={p.mobile ?? ''} onChange={(e) => setP({ ...p, mobile: e.target.value })} /></Field>
            <Field label="GSTIN"><Input value={p.gstin ?? ''} onChange={(e) => setP({ ...p, gstin: e.target.value })} /></Field>
            <Field label="Address" className="md:col-span-2"><Input value={p.address ?? ''} onChange={(e) => setP({ ...p, address: e.target.value })} /></Field>
            <Field label="City"><Input value={p.city ?? ''} onChange={(e) => setP({ ...p, city: e.target.value })} /></Field>
            <Field label="Credit days" hint="Due date = bill date + credit days"><Input type="number" value={p.credit_days ?? 0} onChange={(e) => setP({ ...p, credit_days: Number(e.target.value) })} /></Field>
          </div>
          <div><span className="field-label">Roles</span><div className="flex flex-wrap gap-3">{ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={roles.includes(r)}
              onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />{r.replace('_', ' ')}</label>))}</div></div>
          <Toggle label="Active" checked={p.is_active ?? true} onChange={(v) => setP({ ...p, is_active: v })} />
          {(can('parties.edit') || (!p.id && can('parties.create'))) && <div className="flex justify-end"><Button busy={busy} onClick={save}>Save</Button></div>}
        </div>
      )}
      {tab === 'portal' && p.id && <PortalAccess partyId={p.id} isCustomer={isCustomer} isVendor={isVendor} defaultEmail={p.email ?? ''} />}
      {tab === 'overrides' && p.id && <Overrides partyId={p.id} />}
      {tab === 'prices' && p.id && <Prices partyId={p.id} rateType={isCustomer ? 'SALE' : 'PURCHASE'} />}
      {tab === 'docs' && p.id && <DocumentsPanel companyId={companyId} entityType="party" entityId={p.id} />}
    </Modal>
  );
}

function PortalAccess({ partyId, isCustomer, isVendor, defaultEmail }: { partyId: string; isCustomer: boolean; isVendor: boolean; defaultEmail: string }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const [email, setEmail] = useState(defaultEmail.split(/[,;\s]+/)[0] ?? '');
  const [name, setName] = useState('');
  const [kind, setKind] = useState(isCustomer ? 'CUSTOMER' : 'VENDOR');
  const users = useData(async () => must<{ id: string; kind: string; email: string; display_name: string | null; is_active: boolean; claimed_at: string | null; last_login_at: string | null }[]>(
    await sb().from('portal_users').select('*').eq('party_id', partyId).order('invited_at')), [partyId]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Portal users sign in with their email (password or one-time code). They see only this party&apos;s own POs, orders, invoices, payments and shared documents.</p>
      <Table><thead><tr><th>Email</th><th>Portal</th><th>Status</th><th>First login</th><th>Last login</th><th /></tr></thead>
        <tbody>{(users.data ?? []).map((u) => (
          <tr key={u.id}><td>{u.email}{u.display_name && <div className="text-xs text-slate-500">{u.display_name}</div>}</td><td>{u.kind}</td>
            <td><Badge color={u.is_active ? 'green' : 'slate'}>{u.is_active ? (u.claimed_at ? 'Active' : 'Invited') : 'Disabled'}</Badge></td>
            <td>{dateTime(u.claimed_at)}</td><td>{dateTime(u.last_login_at)}</td>
            <td>{can('portal.edit') && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
              await rpc('portal_user_set_active', { p_portal_user_id: u.id, p_active: !u.is_active }); users.reload(); }, u.is_active ? 'Access disabled' : 'Access enabled')}>
              {u.is_active ? 'Disable' : 'Enable'}</Button>}</td></tr>))}
          {users.data?.length === 0 && <tr><td colSpan={6} className="text-slate-500">No portal access yet</td></tr>}</tbody></Table>
      {can('portal.create') && (
        <div className="grid items-end gap-2 md:grid-cols-[1.4fr_1fr_0.8fr_auto]">
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Portal"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={[
            ...(isCustomer ? [{ value: 'CUSTOMER', label: 'Customer' }] : []), ...(isVendor ? [{ value: 'VENDOR', label: 'Vendor' }] : [])]} /></Field>
          <Button busy={busy} onClick={() => run(async () => {
            await rpc('portal_invite', { p_party_id: partyId, p_kind: kind, p_email: email, p_display_name: name || null }); users.reload(); },
            'Access granted — ask the user to sign in with this email')}>Give access</Button>
        </div>
      )}
    </div>
  );
}

type Tri = '' | 'true' | 'false';
function Overrides({ partyId }: { partyId: string }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const cur = useData(async () => must<Record<string, unknown>[]>(await sb().from('party_settings').select('*').eq('party_id', partyId)), [partyId]);
  const [v, setV] = useState<Record<string, string> | null>(null);
  const row = cur.data?.[0] ?? {};
  const val = (k: string) => v?.[k] ?? (row[k] === null || row[k] === undefined ? '' : String(row[k]));
  const set = (k: string, x: string) => setV({ ...(v ?? {}), [k]: x });
  const tri = (k: string, l: string) => (
    <Field label={l}><Select value={val(k)} onChange={(e) => set(k, e.target.value as Tri)}
      options={[{ value: '', label: 'Use company setting' }, { value: 'true', label: 'ON for this party' }, { value: 'false', label: 'OFF for this party' }]} /></Field>);
  const editable = can('portal.edit');
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Priority: this party&apos;s override → company setting → system default. Leave “Use company setting” to follow Settings.</p>
      <fieldset disabled={!editable} className="grid gap-3 md:grid-cols-2">
        <Field label="Stock visibility"><Select value={val('stock_visibility')} onChange={(e) => set('stock_visibility', e.target.value)} options={[
          { value: '', label: 'Use company setting' }, { value: 'HIDDEN', label: 'Hidden' }, { value: 'EXACT_QUANTITY', label: 'Exact quantity' },
          { value: 'AVAILABLE_STATUS', label: 'In stock / Low / Out' }, { value: 'AVAILABLE_TO_PROMISE', label: 'Available to promise' }]} /></Field>
        {tri('rate_visible', 'Rate visibility')}
        {tri('quote_price_enabled', 'Customer may quote a price')}
        {tri('email_enabled', 'Automatic emails to this party')}
        {tri('payment_reminder_enabled', 'Payment reminders')}
      </fieldset>
      {editable ? <div className="flex justify-end"><Button busy={busy} onClick={() => run(async () => {
        const b = (k: string) => (val(k) === '' ? null : val(k) === 'true');
        const payload = { party_id: partyId, stock_visibility: val('stock_visibility') || null, rate_visible: b('rate_visible'),
          quote_price_enabled: b('quote_price_enabled'), email_enabled: b('email_enabled'), payment_reminder_enabled: b('payment_reminder_enabled') };
        must(await sb().from('party_settings').upsert(payload));
        setV(null); cur.reload();
      }, 'Overrides saved')}>Save overrides</Button></div> : <p className="text-xs text-slate-500">Only Owner / Admin can change overrides.</p>}
    </div>
  );
}

function Prices({ partyId, rateType }: { partyId: string; rateType: 'SALE' | 'PURCHASE' }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const items = useItems(companyId);
  const { busy, run } = useAction();
  const [n, setN] = useState({ item_id: '', rate: '', from: new Date().toISOString().slice(0, 10) });
  const rates = useData(async () => must<{ id: string; rate: number; effective_from: string; items: { code: string; name: string; sale_price: number | null; purchase_price: number | null } | null }[]>(
    await sb().from('party_item_rates').select('id, rate, effective_from, items(code, name, sale_price, purchase_price)').eq('party_id', partyId).eq('rate_type', rateType)
      .order('effective_from', { ascending: false })), [partyId, rateType]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{rateType === 'SALE' ? 'Customer-specific sale prices (per base unit). Without one the item sale price is used. Whether the customer can SEE prices is a separate setting.' : 'Vendor-specific purchase prices (per base unit).'}</p>
      <Table><thead><tr><th>Item</th><th className="num">Base price</th><th className="num">This party</th><th>From</th><th /></tr></thead>
        <tbody>{(rates.data ?? []).map((r) => (
          <tr key={r.id}><td>{r.items?.name}<div className="text-xs text-slate-500">{r.items?.code}</div></td>
            <td className="num">{money(rateType === 'SALE' ? r.items?.sale_price : r.items?.purchase_price)}</td><td className="num font-semibold">{money(r.rate)}</td>
            <td>{date(r.effective_from)}</td><td>{can('rates.delete') && <Button variant="ghost" onClick={() => run(async () => {
              must(await sb().from('party_item_rates').delete().eq('id', r.id)); rates.reload(); }, 'Price removed')}>Remove</Button>}</td></tr>))}
          {rates.data?.length === 0 && <tr><td colSpan={5} className="text-slate-500">No party-specific prices</td></tr>}</tbody></Table>
      {can('rates.create') && (
        <div className="grid items-end gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
          <Field label="Item"><Select value={n.item_id} onChange={(e) => setN({ ...n, item_id: e.target.value })} placeholder="Choose"
            options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.code} — ${i.name}` }))} /></Field>
          <Field label="Price"><Input type="number" value={n.rate} onChange={(e) => setN({ ...n, rate: e.target.value })} /></Field>
          <Field label="Effective from"><Input type="date" value={n.from} onChange={(e) => setN({ ...n, from: e.target.value })} /></Field>
          <Button busy={busy} onClick={() => run(async () => {
            if (!n.item_id || !(Number(n.rate) >= 0) || n.rate === '') throw new Error('Choose item and price');
            must(await sb().from('party_item_rates').insert({ company_id: companyId, rate_type: rateType, party_id: partyId, item_id: n.item_id,
              rate: Number(n.rate), effective_from: n.from }));
            setN({ ...n, item_id: '', rate: '' }); rates.reload(); }, 'Price saved')}>Add price</Button>
        </div>
      )}
    </div>
  );
}
