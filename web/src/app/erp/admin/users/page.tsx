'use client';
import { useMemo, useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { useGodowns, useParties, type Godown } from '@/lib/masters';
import { dateTime } from '@/lib/format';
import { adminUsers, type AdminUser, type Permission, type PermissionModule, type Role } from '@/lib/admin';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, useAction } from '@/components/ui';
import { GodownScopePicker, RecordScopePicker, TempPasswordModal } from '@/components/admin/widgets';
import { ScopeEditor } from '@/components/admin/ScopeEditor';
import { buildMatrix } from '@/components/admin/PermissionMatrix';

const KIND_LABEL: Record<string, string> = { INTERNAL: 'Internal', CUSTOMER: 'Customer', VENDOR: 'Vendor' };

export default function UsersPage() {
  const companyId = useCompanyId();
  const { can, boot } = useSession();
  const { busy, run } = useAction();
  const users = useData(() => rpc<AdminUser[]>('admin_users', { p_company_id: companyId }), [companyId]);
  const roles = useData(async () => must<Role[]>(await sb().from('roles')
    .select('id, code, name, description, kind, is_active, is_locked, grants_all, is_system, sort_order')
    .eq('company_id', companyId).eq('kind', 'INTERNAL').order('sort_order').order('name')), [companyId]);
  const godowns = useGodowns(companyId);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [roleF, setRoleF] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<AdminUser | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);

  const rows = useMemo(() => (users.data ?? []).filter((u) => {
    const s = q.trim().toLowerCase();
    return (!s || [u.full_name, u.email, u.party_name, u.department, u.employee_code, ...u.roles.map((r) => r.name)]
      .some((x) => (x ?? '').toLowerCase().includes(s)))
      && (!kind || u.kind === kind) && (!status || u.status === status)
      && (!roleF || u.roles.some((r) => r.id === roleF));
  }), [users.data, q, kind, status, roleF]);
  const godownName = (id: string) => godowns.data?.find((g) => g.id === id)?.code ?? '?';

  const bulk = (active: boolean) => run(async () => {
    const targets = rows.filter((u) => picked.has(u.key) && u.user_id && u.user_id !== boot?.user_id);
    const failed: string[] = [];
    for (const u of targets) {
      try { await adminUsers({ action: 'set_status', company_id: companyId, user_id: u.user_id, active }); }
      catch (e) { failed.push(`${u.email}: ${(e as Error).message}`); }
    }
    setPicked(new Set()); users.reload();
    if (failed.length) throw new Error(failed.join(' · '));
  }, active ? 'Users enabled' : 'Users disabled');

  return (
    <div>
      <PageHeader title="Users" subtitle="Internal staff, customer and vendor logins. Rights come from roles, overrides and data scope — enforced by the database."
        actions={<>
          {can('users.create') && <Button onClick={() => setCreating(true)}>New user</Button>}
          {can('users.create') && <Button variant="secondary" onClick={() => setInviting(true)}>Invite by email</Button>}
        </>} />
      <ErrorBox error={users.error} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Search" className="w-64"><Input placeholder="name, email, role, customer…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Select aria-label="Type" className="w-36" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="All types"
          options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="Status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses"
          options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }]} />
        <Select aria-label="Role filter" className="w-44" value={roleF} onChange={(e) => setRoleF(e.target.value)} placeholder="All roles"
          options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
        {can('users.disable') && picked.size > 0 && <>
          <span className="text-sm text-slate-600">{picked.size} selected</span>
          <Button variant="secondary" busy={busy} onClick={() => bulk(true)}>Enable</Button>
          <Button variant="danger" busy={busy} onClick={() => { if (window.confirm(`Disable ${picked.size} user(s)?`)) bulk(false); }}>Disable</Button>
        </>}
      </div>
      {!users.data ? (users.error ? null : <Spinner />) : (
        <Table>
          <thead><tr>
            {can('users.disable') && <th className="w-8"><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((u) => picked.has(u.key))}
              onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((u) => u.key)) : new Set())} /></th>}
            <th>User</th><th>Type</th><th>Roles / account</th><th>Godowns</th><th>Status</th><th>Last login</th>
          </tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.key}>
                {can('users.disable') && <td><input type="checkbox" aria-label={`Select ${u.email}`} checked={picked.has(u.key)}
                  onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(u.key); else n.delete(u.key); setPicked(n); }} /></td>}
                <td>
                  <button className="text-left font-medium text-brand hover:underline" onClick={() => setOpen(u)}>{u.full_name}</button>
                  <div className="text-xs text-slate-500">{u.email}{u.department ? ` · ${u.department}` : ''}</div>
                </td>
                <td><Badge color={u.kind === 'INTERNAL' ? 'blue' : 'slate'}>{KIND_LABEL[u.kind]}</Badge></td>
                <td className="space-x-1">
                  {u.is_owner && <Badge color="amber">Owner</Badge>}
                  {u.kind === 'INTERNAL' ? u.roles.filter((r) => !(u.is_owner && r.code === 'OWNER')).map((r) => <Badge key={r.id} color="blue">{r.name}</Badge>)
                    : <span>{u.party_name}</span>}
                </td>
                <td className="text-sm">{u.kind !== 'INTERNAL' ? '—' : u.godown_ids?.length ? u.godown_ids.map(godownName).join(', ') : 'All'}</td>
                <td>
                  <Badge color={u.status === 'ACTIVE' ? 'green' : 'red'}>{u.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge>
                  {u.must_change_password && <div className="mt-1"><Badge color="amber">Temporary password</Badge></div>}
                  {u.kind !== 'INTERNAL' && !u.claimed && <div className="mt-1"><Badge color="slate">Invitation pending</Badge></div>}
                </td>
                <td className="whitespace-nowrap text-sm">{u.last_sign_in_at ? dateTime(u.last_sign_in_at) : 'Never'}</td>
              </tr>))}
            {rows.length === 0 && <tr><td colSpan={7} className="text-slate-500">No users</td></tr>}
          </tbody>
        </Table>)}

      {creating && <CreateUser roles={(roles.data ?? []).filter((r) => r.is_active)} godowns={godowns.data ?? []}
        onClose={() => setCreating(false)}
        onCreated={(r) => { setCreating(false); users.reload(); if (r.password) setTemp(r as { email: string; password: string }); }} />}
      {inviting && <InviteUser roles={(roles.data ?? []).filter((r) => r.is_active)} onClose={() => setInviting(false)} onDone={() => { setInviting(false); users.reload(); }} />}
      {open && <UserDrawer user={open} roles={roles.data ?? []} onClose={() => setOpen(null)}
        onChanged={() => users.reload()} onTempPassword={setTemp} />}
      <TempPasswordModal value={temp} onClose={() => setTemp(null)} />
    </div>
  );
}

// -----------------------------------------------------------------------------
function CreateUser({ roles, godowns, onClose, onCreated }: { roles: Role[]; godowns: Godown[]; onClose: () => void;
  onCreated: (r: { email: string; password: string | null }) => void }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const [f, setF] = useState({ kind: 'INTERNAL', email: '', full_name: '', mobile: '', department: '', designation: '', employee_code: '', party_id: '' });
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [gd, setGd] = useState<string[]>([]);
  const customers = useParties(companyId, 'CUSTOMER');
  const vendors = useParties(companyId, ['SUPPLIER', 'JOB_WORKER', 'CUTTER']);
  const parties = f.kind === 'CUSTOMER' ? customers.data : vendors.data;
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  const save = () => run(async () => {
    const payload: Record<string, unknown> = { kind: f.kind, email: f.email.trim(), full_name: f.full_name.trim(), mobile: f.mobile.trim() };
    if (f.kind === 'INTERNAL') Object.assign(payload, { department: f.department, designation: f.designation, employee_code: f.employee_code,
      role_ids: roleIds, godown_ids: gd });
    else payload.party_id = f.party_id;
    const r = await adminUsers<{ email: string; temporary_password: string | null; existing_login: boolean }>(
      { action: 'create', company_id: companyId, payload });
    onCreated({ email: r.email, password: r.temporary_password });
  }, 'User created');

  return (
    <Modal open wide title="New user" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="User type"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}
            options={[{ value: 'INTERNAL', label: 'Internal (staff)' }, { value: 'CUSTOMER', label: 'Customer portal' }, { value: 'VENDOR', label: 'Vendor portal' }]} /></Field>
          <Field label="Email / login ID"><Input type="email" required value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Name"><Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
          <Field label="Mobile"><Input value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
          {f.kind === 'INTERNAL' ? <>
            <Field label="Employee code"><Input value={f.employee_code} onChange={(e) => set('employee_code', e.target.value)} /></Field>
            <Field label="Department"><Input value={f.department} onChange={(e) => set('department', e.target.value)} /></Field>
            <Field label="Designation"><Input value={f.designation} onChange={(e) => set('designation', e.target.value)} /></Field>
          </> : (
            <Field label={f.kind === 'CUSTOMER' ? 'Customer' : 'Vendor'} className="md:col-span-2">
              <Select value={f.party_id} onChange={(e) => set('party_id', e.target.value)} placeholder="Select…"
                options={(parties ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))} /></Field>)}
        </div>
        {f.kind === 'INTERNAL' && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <span className="field-label">Roles</span>
              <div className="grid gap-1" role="group" aria-label="Roles">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm" title={r.description}>
                    <input type="checkbox" aria-label={`Role ${r.name}`} checked={roleIds.includes(r.id)}
                      onChange={(e) => setRoleIds(e.target.checked ? [...roleIds, r.id] : roleIds.filter((x) => x !== r.id))} />
                    {r.name}</label>))}
              </div>
            </div>
            {can('users.assign_scope') && <div><span className="field-label">Godown access</span>
              <GodownScopePicker godowns={godowns} value={gd} onChange={setGd} /></div>}
          </div>)}
        <p className="text-sm text-slate-500">A strong temporary password is generated and shown once. The user must change it at the first login.
          If the email already has a login (e.g. at another company), access is added and the password is not changed.</p>
        <div className="text-right"><Button type="submit" busy={busy}>Create user</Button></div>
      </form>
    </Modal>
  );
}

function InviteUser({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const companyId = useCompanyId();
  const { busy, run } = useAction();
  const [n, setN] = useState({ email: '', name: '', role: roles.find((r) => r.code === 'OPERATOR')?.code ?? roles[0]?.code ?? '' });
  return (
    <Modal open title="Invite by email" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => {
        await rpc('user_invite', { p_company_id: companyId, p_email: n.email, p_role_code: n.role, p_full_name: n.name || null });
        onDone(); }, 'Invited — the user signs in with this email (sign-in code)'); }}>
        <Field label="Email"><Input type="email" required value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></Field>
        <Field label="Name"><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
        <Field label="Role"><Select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })} options={roles.map((r) => ({ value: r.code, label: r.name }))} /></Field>
        <p className="text-sm text-slate-500">No password is created: the person signs in with a one-time code sent to the email address.</p>
        <div className="text-right"><Button type="submit" busy={busy}>Invite</Button></div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
interface Detail {
  user_id: string; email: string; full_name: string; is_owner: boolean; must_change_password: boolean;
  password_changed_at: string | null; last_sign_in_at: string | null;
  membership: { status: string; mobile: string | null; department: string | null; designation: string | null; employee_code: string | null;
    notes: string | null; disabled_reason: string | null; disabled_at: string | null } | null;
  role_ids: string[]; overrides: { permission_code: string; effect: 'ALLOW' | 'DENY'; reason: string | null }[];
  scopes: Record<string, string[]>; effective_scopes: Record<string, string[] | null>; permissions: string[];
  portal: { id: string; kind: string; party_name: string; is_active: boolean }[];
  history: { at: string; action: string; old: unknown; new: unknown; actor: string }[];
}

function UserDrawer({ user, roles, onClose, onChanged, onTempPassword }: {
  user: AdminUser; roles: Role[]; onClose: () => void; onChanged: () => void;
  onTempPassword: (v: { email: string; password: string }) => void;
}) {
  const companyId = useCompanyId();
  const { can, boot } = useSession();
  const { busy, run } = useAction();
  const internal = user.kind === 'INTERNAL';
  const detail = useData(async () => (user.user_id ? rpc<Detail>('admin_user_detail', { p_company_id: companyId, p_user_id: user.user_id }) : null),
    [companyId, user.user_id]);
  const [tab, setTab] = useState(internal ? 'profile' : 'security');
  const self = user.user_id === boot?.user_id;
  const d = detail.data;
  const tabs = internal
    ? [{ id: 'profile', label: 'Profile' }, { id: 'roles', label: 'Roles' }, { id: 'perms', label: 'Permissions' },
       { id: 'scope', label: 'Data access' }, { id: 'security', label: 'Login & security' }, { id: 'history', label: 'History' }]
    : [{ id: 'security', label: 'Login & security' }, { id: 'portal', label: 'Portal role' }, { id: 'history', label: 'History' }];
  const after = () => { detail.reload(); onChanged(); };

  return (
    <Modal open wide title={`${user.full_name} · ${KIND_LABEL[user.kind]}`} onClose={onClose}>
      {!user.user_id ? (
        <div className="space-y-3">
          <p className="text-sm">Invitation for <b>{user.email}</b> ({user.party_name}) is not used yet — the person signs in with a code sent to this email.</p>
          {can('portal.edit') && user.portal_user_id && <Button variant="secondary" busy={busy} onClick={() => run(async () => {
            await rpc('portal_user_set_active', { p_portal_user_id: user.portal_user_id, p_active: user.status !== 'ACTIVE' }); onChanged(); onClose();
          }, 'Saved')}>{user.status === 'ACTIVE' ? 'Withdraw invitation' : 'Re-activate invitation'}</Button>}
        </div>
      ) : !d ? (detail.error ? <ErrorBox error={detail.error} /> : <Spinner />) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm text-slate-600">
            <span>{d.email}</span>
            {d.is_owner && <Badge color="amber">Owner</Badge>}
            <Badge color={user.status === 'ACTIVE' ? 'green' : 'red'}>{user.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge>
            {d.must_change_password && <Badge color="amber">Temporary password</Badge>}
          </div>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          {tab === 'profile' && <ProfileTab key={JSON.stringify(d.membership)} d={d} onSaved={after} />}
          {tab === 'roles' && <RolesTab key={d.role_ids.join()} d={d} roles={roles} self={self} onSaved={after} />}
          {tab === 'perms' && <OverridesTab key={JSON.stringify(d.overrides)} d={d} self={self} onSaved={after} />}
          {tab === 'scope' && <ScopeTab key={JSON.stringify(d.scopes)} d={d} self={self} onSaved={after} />}
          {tab === 'portal' && <PortalRoleTab userId={d.user_id} onSaved={after} />}
          {tab === 'security' && (
            <div className="space-y-3 text-sm">
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[180px_1fr]">
                <dt className="text-slate-500">Last login</dt><dd>{d.last_sign_in_at ? dateTime(d.last_sign_in_at) : 'Never'}</dd>
                <dt className="text-slate-500">Password changed</dt><dd>{d.password_changed_at ? dateTime(d.password_changed_at) : '—'}</dd>
                <dt className="text-slate-500">Status</dt><dd>{user.status}{d.membership?.disabled_reason ? ` — ${d.membership.disabled_reason}` : ''}</dd>
                {d.portal.length > 0 && <><dt className="text-slate-500">Portal access</dt>
                  <dd>{d.portal.map((p) => `${p.kind.toLowerCase()} · ${p.party_name}${p.is_active ? '' : ' (off)'}`).join(', ')}</dd></>}
              </dl>
              {self ? <p className="text-slate-500">Use “My account” to change your own password.</p> : (
                <div className="flex flex-wrap gap-2">
                  {can('users.reset_password') && <Button variant="secondary" busy={busy} onClick={() => {
                    if (!window.confirm(`Generate a new temporary password for ${d.email}? The current password stops working.`)) return;
                    run(async () => {
                      const r = await adminUsers<{ email: string; temporary_password: string }>({ action: 'reset_password', company_id: companyId, user_id: d.user_id });
                      onTempPassword({ email: r.email, password: r.temporary_password }); after();
                    }, 'Password reset');
                  }}>Reset password</Button>}
                  {can('users.disable') && (user.status === 'ACTIVE'
                    ? <Button variant="danger" busy={busy} onClick={() => {
                        const reason = window.prompt(`Disable ${d.email}? Reason (optional):`);
                        if (reason === null) return;
                        run(async () => { await adminUsers({ action: 'set_status', company_id: companyId, user_id: d.user_id, active: false, reason }); after(); onClose(); }, 'User disabled');
                      }}>Disable user</Button>
                    : <Button busy={busy} onClick={() => run(async () => {
                        await adminUsers({ action: 'set_status', company_id: companyId, user_id: d.user_id, active: true }); after(); onClose(); }, 'User enabled')}>Enable user</Button>)}
                </div>)}
              {!internal && <p className="text-slate-500">What this customer / vendor login can see is set in Settings → Portals and per customer / vendor
                (Customers / Vendors → Portal &amp; visibility) and by the portal role (tab “Portal role”).</p>}
            </div>)}
          {tab === 'history' && (
            <Table><thead><tr><th>When</th><th>Action</th><th>By</th><th>Details</th></tr></thead>
              <tbody>{d.history.map((h, i) => (
                <tr key={i}><td className="whitespace-nowrap">{dateTime(h.at)}</td><td><Badge>{h.action}</Badge></td><td>{h.actor}</td>
                  <td className="max-w-md break-all text-xs text-slate-600">{h.new ? JSON.stringify(h.new) : h.old ? JSON.stringify(h.old) : ''}</td></tr>))}
                {d.history.length === 0 && <tr><td colSpan={4} className="text-slate-500">No entries</td></tr>}</tbody></Table>)}
        </>)}
    </Modal>
  );
}

function ProfileTab({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const m = d.membership;
  const [f, setF] = useState({ full_name: d.full_name ?? '', mobile: m?.mobile ?? '', department: m?.department ?? '',
    designation: m?.designation ?? '', employee_code: m?.employee_code ?? '', notes: m?.notes ?? '' });
  const dis = !can('users.edit');
  const depts = useData(async () => must<{ id: string; name: string }[]>(await sb().from('departments').select('id, name')
    .eq('company_id', companyId).eq('is_active', true).order('name')), [companyId]);
  const field = (k: keyof typeof f, label: string) => k === 'department' ? (
    <Field label={label}><Select aria-label="Department" value={f.department} disabled={dis} placeholder="— none —"
      options={[...(depts.data ?? []).map((x) => ({ value: x.name, label: x.name })),
                ...(f.department && !(depts.data ?? []).some((x) => x.name === f.department) ? [{ value: f.department, label: f.department }] : [])]}
      onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>) : (
    <Field label={label}><Input value={f[k]} disabled={dis} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => {
      await rpc('user_update', { p_company_id: companyId, p_user_id: d.user_id, p_payload: f }); onSaved(); }, 'Profile saved'); }}>
      <div className="grid gap-3 md:grid-cols-3">
        {field('full_name', 'Name')}{field('mobile', 'Mobile')}{field('employee_code', 'Employee code')}
        {field('department', 'Department')}{field('designation', 'Designation')}{field('notes', 'Notes')}
      </div>
      {!dis && <div className="text-right"><Button type="submit" busy={busy}>Save profile</Button></div>}
    </form>
  );
}

function RolesTab({ d, roles, self, onSaved }: { d: Detail; roles: Role[]; self: boolean; onSaved: () => void }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const [ids, setIds] = useState<string[]>(d.role_ids);
  const dis = !can('users.assign_role') || (self && !d.is_owner);
  return (
    <div className="space-y-3">
      <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Roles">
        {roles.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm" title={r.description}>
            <input type="checkbox" aria-label={`Role ${r.name}`} disabled={dis || (!r.is_active && !ids.includes(r.id))} checked={ids.includes(r.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id))} />
            {r.name}{!r.is_active && <span className="text-xs text-slate-400">(disabled)</span>}</label>))}
      </div>
      {self && !d.is_owner && <p className="text-sm text-slate-500">You cannot change your own roles.</p>}
      {!dis && <div className="text-right"><Button busy={busy} onClick={() => run(async () => {
        await rpc('user_set_roles', { p_company_id: companyId, p_user_id: d.user_id, p_role_ids: ids }); onSaved(); }, 'Roles saved')}>Save roles</Button></div>}
    </div>
  );
}

function OverridesTab({ d, self, onSaved }: { d: Detail; self: boolean; onSaved: () => void }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const perms = useData(async () => must<Permission[]>(await sb().from('permissions')
    .select('code, module, action, label, description, kind, sort_order, is_sensitive')), []);
  const modules = useData(async () => must<PermissionModule[]>(await sb().from('permission_modules').select('*')), []);
  const [ov, setOv] = useState<Record<string, 'ALLOW' | 'DENY'>>(() => Object.fromEntries(d.overrides.map((o) => [o.permission_code, o.effect])));
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const effective = new Set(d.permissions);
  const dis = !can('users.assign_permissions') || d.is_owner || (self && !d.is_owner);
  if (d.is_owner) return <p className="text-sm">The owner always has every permission.</p>;
  if (!perms.data || !modules.data) return <Spinner />;
  const { groups } = buildMatrix(perms.data, modules.data);
  const s = q.trim().toLowerCase();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Effective rights = roles + <b>Allow</b> − <b>Deny</b>. Use overrides for exceptions; prefer roles for groups of users.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Find" className="w-60"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="module or permission" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />Only overrides</label>
      </div>
      <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
        <table className="erp-table"><thead><tr><th>Permission</th><th>Now</th><th>Override</th></tr></thead>
          <tbody>{groups.flatMap((g) => g.rows).flatMap((r) => [...Object.values(r.cells).filter(Boolean) as Permission[], ...r.more]
            .filter((p) => (!s || p.code.includes(s) || r.module.label.toLowerCase().includes(s)) && (!onlyChanged || ov[p.code]))
            .map((p) => (
              <tr key={p.code}>
                <td><span className="font-medium">{r.module.label}</span> · {p.label ?? p.action} <span className="text-xs text-slate-400">{p.code}</span></td>
                <td>{effective.has(p.code) ? <Badge color="green">Yes</Badge> : <Badge color="slate">No</Badge>}</td>
                <td><Select aria-label={`Override ${p.code}`} className="w-32" disabled={dis} value={ov[p.code] ?? ''}
                  onChange={(e) => { const n = { ...ov }; if (e.target.value) n[p.code] = e.target.value as 'ALLOW' | 'DENY'; else delete n[p.code]; setOv(n); }}
                  options={[{ value: '', label: 'From roles' }, { value: 'ALLOW', label: 'Allow' }, { value: 'DENY', label: 'Deny' }]} /></td>
              </tr>)))}</tbody></table>
      </div>
      {!dis && <div className="text-right"><Button busy={busy} onClick={() => run(async () => {
        await rpc('user_set_overrides', { p_company_id: companyId, p_user_id: d.user_id,
          p_overrides: Object.entries(ov).map(([permission_code, effect]) => ({ permission_code, effect })) });
        onSaved(); }, 'Overrides saved')}>Save overrides</Button></div>}
    </div>
  );
}

function ScopeTab({ d, self, onSaved }: { d: Detail; self: boolean; onSaved: () => void }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const dis = !can('users.assign_scope') || d.is_owner || (self && !d.is_owner);
  const rec = useData(async () => (await sb().from('company_users').select('record_scope').eq('company_id', companyId).eq('user_id', d.user_id)
    .maybeSingle()).data?.record_scope ?? null, [companyId, d.user_id]);
  if (d.is_owner) return <p className="text-sm">The owner always has access to all records.</p>;
  return (
    <div className="space-y-4">
    {rec.loading ? <Spinner /> : <RecordScopePicker key={rec.data ?? ''} value={rec.data} allowInherit disabled={dis} onSave={async (v) => {
      await rpc('user_set_record_scope', { p_company_id: companyId, p_user_id: d.user_id, p_scope: v }); rec.reload(); onSaved(); }} />}
    <ScopeEditor stored={d.scopes} effective={d.effective_scopes} disabled={dis}
      intro="A setting here overrides the user's roles. Godowns limit stock, locations, reservations and godown documents; customers and vendors limit the master, rates and their documents; items limit the item master, rates, images, stock and document lines. Enforced by the database."
      onSave={async (dimension, ids) => {
        await rpc('user_set_scope', { p_company_id: companyId, p_user_id: d.user_id, p_dimension: dimension, p_entity_ids: ids }); onSaved(); }} />
    </div>
  );
}

/** Portal role of a customer / vendor login: which portal features it may use (Roles → Customer / Vendor portal roles). */
function PortalRoleTab({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { run } = useAction();
  const links = useData(async () => must<{ id: string; kind: string; role_id: string | null; is_active: boolean; parties: { name: string } | null }[]>(
    await sb().from('portal_users').select('id, kind, role_id, is_active, parties(name)').eq('company_id', companyId).eq('user_id', userId)), [companyId, userId]);
  const roles = useData(async () => must<Role[]>(await sb().from('roles')
    .select('id, code, name, description, kind, is_active, is_locked, grants_all, is_system, sort_order')
    .eq('company_id', companyId).neq('kind', 'INTERNAL').order('sort_order').order('name')), [companyId]);
  if (!links.data || !roles.data) return <Spinner />;
  return (
    <div className="space-y-3">
      <ErrorBox error={links.error || roles.error} />
      {links.data.map((l) => (
        <Field key={l.id} label={`${l.kind === 'CUSTOMER' ? 'Customer' : 'Vendor'} portal · ${l.parties?.name ?? ''}`}>
          <Select aria-label="Portal role" className="max-w-sm" value={l.role_id ?? ''} disabled={!can('portal.edit')}
            onChange={(e) => run(async () => {
              await rpc('portal_user_set_role', { p_portal_user_id: l.id, p_role_id: e.target.value }); links.reload(); onSaved();
            }, 'Portal role saved')}
            options={roles.data!.filter((r) => r.kind === `${l.kind}_PORTAL` && r.is_active).map((r) => ({ value: r.id, label: r.name }))} />
        </Field>))}
      {links.data.length === 0 && <p className="text-sm text-slate-500">No portal access.</p>}
    </div>
  );
}
