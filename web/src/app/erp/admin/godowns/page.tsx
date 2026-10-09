'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { AuditTrail } from '@/components/AuditTrail';
import { Badge, Button, ErrorBox, Field, Modal, PageHeader, Select, Spinner, Table, Tabs, Toggle, useAction } from '@/components/ui';

interface G { id: string; code: string; name: string; is_active: boolean; is_default: boolean; manager_user_id: string | null;
  receipts_allowed: boolean; dispatch_allowed: boolean; transfers_allowed: boolean }
interface GUser { user_id: string; email: string; full_name: string | null; access: 'ALL' | 'SELECTED' }
interface Member { user_id: string | null; email: string; kind: string }

/** Godown master administration: manager, default godown, transaction flags, assigned users, delete where safe, audit. */
export default function GodownAdmin() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const list = useData(async () => must<G[]>(await sb().from('godowns')
    .select('id, code, name, is_active, is_default, manager_user_id, receipts_allowed, dispatch_allowed, transfers_allowed')
    .eq('company_id', companyId).eq('is_deleted', false).order('code')), [companyId]);
  const [sel, setSel] = useState<G | null>(null);
  return (
    <div>
      <PageHeader title="Godown administration" subtitle="Racks, shelves and bins stay in Inventory → Godowns & locations" />
      <ErrorBox error={list.error} />
      {!list.data ? (list.error ? null : <Spinner />) : (
        <Table><thead><tr><th>Code</th><th>Name</th><th>Receipts</th><th>Dispatch</th><th>Transfers</th><th>Status</th><th /></tr></thead>
          <tbody>{list.data.map((g) => (
            <tr key={g.id} data-testid={`godown-${g.code}`}>
              <td>{g.code} {g.is_default && <Badge color="blue">Default</Badge>}</td><td>{g.name}</td>
              {[g.receipts_allowed, g.dispatch_allowed, g.transfers_allowed].map((f, i) => <td key={i}><Badge color={f ? 'green' : 'red'}>{f ? 'Allowed' : 'Blocked'}</Badge></td>)}
              <td><Badge color={g.is_active ? 'green' : 'slate'}>{g.is_active ? 'Active' : 'Inactive'}</Badge></td>
              <td><Button variant="ghost" onClick={() => setSel(g)}>Open</Button></td></tr>))}</tbody></Table>)}
      {sel && <GodownDrawer companyId={companyId} g={sel} canEdit={can('godowns.edit')} canDelete={can('godowns.delete')} canUsers={can('users.assign_scope')}
        onClose={() => setSel(null)} onSaved={() => { setSel(null); list.reload(); }} />}
    </div>
  );
}

function GodownDrawer({ companyId, g, canEdit, canDelete, canUsers, onClose, onSaved }: { companyId: string; g: G; canEdit: boolean; canDelete: boolean;
  canUsers: boolean; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState('general');
  const [d, setD] = useState(g);
  const { busy, run } = useAction();
  const members = useData(async () => (await rpc<Member[]>('admin_users', { p_company_id: companyId })).filter((m) => m.kind === 'INTERNAL' && m.user_id),
    [companyId]);
  const users = useData(() => rpc<GUser[]>('godown_users', { p_godown_id: g.id }), [g.id]);
  const [add, setAdd] = useState('');
  return (
    <Modal open wide title={`Godown ${g.code} — ${g.name}`} onClose={onClose}>
      <Tabs tabs={[{ id: 'general', label: 'General' }, { id: 'users', label: 'Users' }, { id: 'audit', label: 'Audit' }]} active={tab} onChange={setTab} />
      {tab === 'general' && <>
        <div className="grid gap-x-6 md:grid-cols-2">
          <Field label="Manager"><Select aria-label="Manager" disabled={!canEdit} value={d.manager_user_id ?? ''} placeholder="— none —"
            options={(members.data ?? []).map((m) => ({ value: m.user_id!, label: m.email }))} onChange={(e) => setD({ ...d, manager_user_id: e.target.value || null })} /></Field>
          <Toggle label="Default godown" hint="Pre-selected on new documents" checked={d.is_default} disabled={!canEdit} onChange={(v) => setD({ ...d, is_default: v })} />
          <Toggle label="Receipts allowed" hint="Purchase / job-work / production receipts and stock in" checked={d.receipts_allowed} disabled={!canEdit} onChange={(v) => setD({ ...d, receipts_allowed: v })} />
          <Toggle label="Dispatch allowed" hint="Sales dispatch, issues, returns to vendors, stock out" checked={d.dispatch_allowed} disabled={!canEdit} onChange={(v) => setD({ ...d, dispatch_allowed: v })} />
          <Toggle label="Transfers allowed" checked={d.transfers_allowed} disabled={!canEdit} onChange={(v) => setD({ ...d, transfers_allowed: v })} />
          <Toggle label="Active" checked={d.is_active} disabled={!canEdit} onChange={(v) => setD({ ...d, is_active: v })} />
        </div>
        <div className="mt-4 flex justify-between gap-2">
          {canDelete ? <Button variant="danger" busy={busy} onClick={() => run(async () => {
            if (!window.confirm(`Delete godown ${g.code}? This is only possible when it was never used.`)) return;
            await rpc('master_delete', { p_company_id: companyId, p_kind: 'GODOWN', p_id: g.id }); onSaved(); }, 'Godown deleted')}>Delete</Button> : <span />}
          {canEdit && <Button busy={busy} onClick={() => run(async () => {
            const patch = { manager_user_id: d.manager_user_id, is_default: d.is_default, receipts_allowed: d.receipts_allowed,
              dispatch_allowed: d.dispatch_allowed, transfers_allowed: d.transfers_allowed, is_active: d.is_active };
            if (d.is_default && !g.is_default) must(await sb().from('godowns').update({ is_default: false }).eq('company_id', companyId).eq('is_default', true));
            must(await sb().from('godowns').update(patch).eq('id', g.id)); onSaved(); }, 'Godown saved')}>Save</Button>}
        </div>
      </>}
      {tab === 'users' && <>
        <p className="mb-2 text-sm text-slate-500">Users with access to this godown. Users with “all godowns” are listed as ALL; assigning one of them here
          restricts them to the godowns they are assigned to.</p>
        <ErrorBox error={users.error} />
        <Table><thead><tr><th>User</th><th>Access</th><th /></tr></thead>
          <tbody>{(users.data ?? []).map((u) => (
            <tr key={u.user_id}><td>{u.email}</td><td><Badge color={u.access === 'ALL' ? 'blue' : 'green'}>{u.access === 'ALL' ? 'All godowns' : 'Assigned'}</Badge></td>
              <td>{canUsers && u.access === 'SELECTED' && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
                await rpc('godown_assign_user', { p_godown_id: g.id, p_user_id: u.user_id, p_assign: false }); users.reload(); }, 'Removed')}>Remove</Button>}</td></tr>))}</tbody></Table>
        {canUsers && <div className="mt-3 flex gap-2">
          <Select aria-label="Assign user" value={add} placeholder="Assign a user…" onChange={(e) => setAdd(e.target.value)}
            options={(members.data ?? []).filter((m) => !(users.data ?? []).some((u) => u.user_id === m.user_id && u.access === 'SELECTED'))
              .map((m) => ({ value: m.user_id!, label: m.email }))} />
          <Button busy={busy} disabled={!add} onClick={() => run(async () => {
            const wasAll = (users.data ?? []).some((u) => u.user_id === add && u.access === 'ALL');
            if (wasAll && !window.confirm('This user can see all godowns today. Assigning restricts the user to the assigned godowns. Continue?')) return;
            await rpc('godown_assign_user', { p_godown_id: g.id, p_user_id: add, p_assign: true }); setAdd(''); users.reload(); }, 'User assigned')}>Assign</Button>
        </div>}
      </>}
      {tab === 'audit' && <AuditTrail companyId={companyId} table="godowns" rowId={g.id} />}
    </Modal>
  );
}
