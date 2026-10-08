'use client';
import { useMemo, useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useGodowns } from '@/lib/masters';
import type { Permission, PermissionModule, Role } from '@/lib/admin';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Toggle, useAction } from '@/components/ui';
import { PermissionMatrix } from '@/components/admin/PermissionMatrix';
import { GodownScopePicker } from '@/components/admin/widgets';

export default function RolesPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const roles = useData(async () => must<Role[]>(await sb().from('roles')
    .select('id, code, name, description, kind, is_active, is_locked, grants_all, is_system, sort_order')
    .eq('company_id', companyId).eq('kind', 'INTERNAL').order('sort_order').order('name')), [companyId]);
  const perms = useData(async () => must<Permission[]>(await sb().from('permissions')
    .select('code, module, action, label, description, kind, sort_order, is_sensitive').order('module').order('sort_order')), []);
  const modules = useData(async () => must<PermissionModule[]>(await sb().from('permission_modules').select('*')), []);
  const members = useData(async () => must<{ role_id: string }[]>(await sb().from('user_roles').select('role_id').eq('company_id', companyId)), [companyId]);
  const godowns = useGodowns(companyId);
  const [selId, setSelId] = useState<string>('');
  const [create, setCreate] = useState<{ mode: 'new' | 'clone'; code: string; name: string } | null>(null);
  const role = roles.data?.find((r) => r.id === selId) ?? roles.data?.[0];
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of members.data ?? []) m.set(r.role_id, (m.get(r.role_id) ?? 0) + 1);
    return m;
  }, [members.data]);

  const saveNew = () => run(async () => {
    if (!create) return;
    const id = create.mode === 'clone' && role
      ? await rpc<string>('role_clone', { p_role_id: role.id, p_code: create.code, p_name: create.name })
      : await rpc<string>('role_save', { p_company_id: companyId, p_role_id: null, p_payload: { code: create.code, name: create.name } });
    setCreate(null); roles.reload(); setSelId(id);
  }, create?.mode === 'clone' ? 'Role duplicated' : 'Role created');

  return (
    <div>
      <PageHeader title="Roles & permissions" subtitle="Roles, their permissions and data access are data — changes apply immediately, no code change."
        actions={can('roles.create') && <>
          <Button onClick={() => setCreate({ mode: 'new', code: '', name: '' })}>New role</Button>
          {role && <Button variant="secondary" onClick={() => setCreate({ mode: 'clone', code: `${role.code}_COPY`, name: `${role.name} (copy)` })}>Duplicate</Button>}
        </>} />
      <ErrorBox error={roles.error || perms.error || modules.error} />
      {!roles.data || !perms.data || !modules.data ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Card title="Roles">
            <ul className="-mx-2 space-y-0.5" aria-label="Roles">
              {roles.data.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelId(r.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm ${role?.id === r.id ? 'bg-brand text-white' : 'hover:bg-slate-100'}`}>
                    <span className={r.is_active ? '' : 'line-through opacity-70'}>{r.name}</span>
                    <span className="text-xs opacity-80">{counts.get(r.id) ?? 0}{r.is_locked ? ' 🔒' : ''}</span>
                  </button>
                </li>))}
            </ul>
          </Card>
          {role && <RoleEditor key={role.id} role={role} perms={perms.data} modules={modules.data} roles={roles.data}
            godowns={godowns.data ?? []} users={counts.get(role.id) ?? 0}
            onChanged={() => { roles.reload(); members.reload(); }} onDeleted={() => { setSelId(''); roles.reload(); }} />}
        </div>
      )}
      <Modal open={!!create} title={create?.mode === 'clone' ? `Duplicate ${role?.name}` : 'New role'} onClose={() => setCreate(null)}>
        {create && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveNew(); }}>
            <Field label="Code" hint="Letters, digits, - and _ (e.g. STORE_A)">
              <Input value={create.code} onChange={(e) => setCreate({ ...create, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Name"><Input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} /></Field>
            {create.mode === 'clone' && <p className="text-sm text-slate-500">Permissions are copied from {role?.name}.</p>}
            <div className="text-right"><Button type="submit" busy={busy}>Save</Button></div>
          </form>)}
      </Modal>
    </div>
  );
}

function RoleEditor({ role, perms, modules, roles, godowns, users, onChanged, onDeleted }: {
  role: Role; perms: Permission[]; modules: PermissionModule[]; roles: Role[]; godowns: { id: string; code: string; name: string; is_active: boolean }[];
  users: number; onChanged: () => void; onDeleted: () => void;
}) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const [tab, setTab] = useState('perms');
  const [head, setHead] = useState({ name: role.name, description: role.description, is_active: role.is_active });
  const current = useData(async () => must<{ permission_code: string }[]>(await sb().from('role_permissions')
    .select('permission_code').eq('role_id', role.id)).map((r) => r.permission_code), [role.id]);
  const scope = useData(async () => must<{ entity_id: string }[]>(await sb().from('role_data_scopes')
    .select('entity_id').eq('role_id', role.id).eq('dimension', 'GODOWN')).map((r) => r.entity_id), [role.id]);
  // edits; null = unchanged (shows what is stored)
  const [edit, setSel] = useState<Set<string> | null>(null);
  const [gdEdit, setGd] = useState<string[] | null>(null);
  const [filter, setFilter] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const editable = can('roles.edit') && !role.is_locked;
  const all = useMemo(() => new Set(perms.map((p) => p.code)), [perms]);
  const before = useMemo(() => new Set(current.data ?? []), [current.data]);
  const sel = edit ?? before;
  const gd = gdEdit ?? scope.data ?? [];
  const added = [...sel].filter((c) => !before.has(c));
  const removed = [...before].filter((c) => !sel.has(c));

  const savePerms = () => run(async () => {
    await rpc('role_set_permissions', { p_role_id: role.id, p_permissions: [...sel] });
    setSel(null); current.reload();
  }, `Permissions saved (+${added.length} / −${removed.length})`);
  const copy = () => run(async () => {
    if (!copyFrom) return;
    const rows = must<{ permission_code: string }[]>(await sb().from('role_permissions').select('permission_code').eq('role_id', copyFrom));
    const src = roles.find((r) => r.id === copyFrom);
    setSel(src?.grants_all ? new Set(all) : new Set(rows.map((r) => r.permission_code)));
  }, 'Permissions copied — review and save');

  return (
    <Card title={<span className="flex items-center gap-2">{role.name}
      <span className="text-xs font-normal text-slate-500">{role.code}</span>
      {role.is_locked && <Badge color="amber">Locked</Badge>}{!role.is_active && <Badge color="slate">Disabled</Badge>}</span>}
      actions={can('roles.delete') && !role.is_locked && (
        <Button variant="danger" busy={busy} disabled={users > 0} title={users > 0 ? 'Role is assigned to users' : undefined}
          onClick={() => { if (window.confirm(`Delete role ${role.name}?`)) run(async () => { await rpc('role_delete', { p_role_id: role.id }); onDeleted(); }, 'Role deleted'); }}>
          Delete</Button>)}>
      <div className="mb-4 grid items-end gap-3 md:grid-cols-[1fr_2fr_auto_auto]">
        <Field label="Name"><Input value={head.name} disabled={!can('roles.edit')} onChange={(e) => setHead({ ...head, name: e.target.value })} /></Field>
        <Field label="Description"><Input value={head.description} disabled={!can('roles.edit')} onChange={(e) => setHead({ ...head, description: e.target.value })} /></Field>
        <Toggle label="Active" checked={head.is_active} disabled={!editable} onChange={(v) => setHead({ ...head, is_active: v })} />
        {can('roles.edit') && <Button variant="secondary" busy={busy} onClick={() => run(async () => {
          await rpc('role_save', { p_company_id: companyId, p_role_id: role.id, p_payload: head });
          onChanged();
        }, 'Role saved')}>Save</Button>}
      </div>
      <p className="mb-3 text-sm text-slate-500">{users} user(s) have this role.{role.grants_all && ' The owner role always has every permission, including future ones; it cannot be reduced or deleted.'}</p>
      <Tabs tabs={[{ id: 'perms', label: 'Permissions' }, { id: 'scope', label: 'Godown access' }]} active={tab} onChange={setTab} />
      {tab === 'perms' && (current.data === null ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Find" className="w-56"><Input placeholder="module or permission" value={filter} onChange={(e) => setFilter(e.target.value)} /></Field>
            {editable && <>
              <Button variant="secondary" onClick={() => setSel(new Set(all))}>Select all</Button>
              <Button variant="secondary" onClick={() => setSel(new Set())}>Clear all</Button>
              <Select aria-label="Copy permissions from role" className="w-52" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}
                placeholder="Copy from role…" options={roles.filter((r) => r.id !== role.id).map((r) => ({ value: r.id, label: r.name }))} />
              <Button variant="secondary" disabled={!copyFrom} onClick={copy}>Copy</Button>
            </>}
          </div>
          <PermissionMatrix perms={perms} modules={modules} value={role.grants_all ? all : sel} onChange={setSel}
            readOnly={!editable} filter={filter} />
          {editable && (
            <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/95 py-2">
              <span className="text-sm text-slate-600">{added.length + removed.length === 0 ? 'No changes'
                : `${added.length} added, ${removed.length} removed`}</span>
              <Button variant="secondary" disabled={added.length + removed.length === 0} onClick={() => setSel(null)}>Undo</Button>
              <Button busy={busy} disabled={added.length + removed.length === 0} onClick={savePerms}>Save permissions</Button>
            </div>)}
        </div>))}
      {tab === 'scope' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Users whose roles are all limited see and post stock, locations, reservations and godown documents
            only of these godowns. A user-level godown assignment overrides the roles. Enforced by the database.</p>
          {role.grants_all ? <p className="text-sm">The owner always has access to all godowns.</p> : scope.data === null ? <Spinner /> : <>
            <GodownScopePicker godowns={godowns} value={gd} onChange={setGd} disabled={!editable || !can('users.assign_scope')} />
            {editable && can('users.assign_scope') && <Button busy={busy} onClick={() => run(async () => {
              await rpc('role_set_scope', { p_role_id: role.id, p_dimension: 'GODOWN', p_entity_ids: gd });
              setGd(null); scope.reload();
            }, 'Godown access saved')}>Save godown access</Button>}
          </>}
        </div>)}
    </Card>
  );
}
