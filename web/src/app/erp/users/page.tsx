'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, useAction } from '@/components/ui';

export default function UsersPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const roles = useData(async () => must<{ id: string; code: string; name: string }[]>(await sb().from('roles').select('id, code, name').eq('company_id', companyId).order('name')), [companyId]);
  const members = useData(() => rpc<{ user_id: string; email: string; full_name: string; roles: string[]; role_names: string[] }[]>(
    'company_members', { p_company_id: companyId }), [companyId]);
  const invites = useData(async () => must<{ id: string; email: string; full_name: string | null; invited_at: string; claimed_at: string | null; revoked_at: string | null; roles: { name: string } | null }[]>(
    await sb().from('user_invitations').select('id, email, full_name, invited_at, claimed_at, revoked_at, roles(name)').eq('company_id', companyId).order('invited_at', { ascending: false })), [companyId]);
  const [n, setN] = useState({ email: '', role: 'OPERATOR', name: '' });
  return (
    <div className="space-y-4">
      <PageHeader title="Users & roles" subtitle="Internal staff. Customers and vendors get portal access from Customers & vendors." />
      <ErrorBox error={members.error} />
      {can('users.create') && (
        <Card title="Invite a team member">
          <div className="grid items-end gap-2 md:grid-cols-[1.5fr_1fr_1fr_auto]">
            <Field label="Email"><Input type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></Field>
            <Field label="Name"><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
            <Field label="Role"><Select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })} options={(roles.data ?? []).map((r) => ({ value: r.code, label: r.name }))} /></Field>
            <Button busy={busy} onClick={() => run(async () => {
              await rpc('user_invite', { p_company_id: companyId, p_email: n.email, p_role_code: n.role, p_full_name: n.name || null });
              setN({ ...n, email: '', name: '' }); invites.reload(); members.reload(); }, 'Invited — the user signs in with this email (code or password)')}>Invite</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Owner / Admin: everything incl. settings. Approver: approves documents. Accounts: invoices, payments, documents, email. Purchase: POs, receiving. Sales: customer POs, orders, dispatch. Operator: data entry. Viewer: read only.</p>
        </Card>
      )}
      <Card title="Members">
        {!members.data ? <Spinner /> : (
          <Table><thead><tr><th>User</th><th>Email</th><th>Roles</th></tr></thead>
            <tbody>{members.data.map((u) => (<tr key={u.user_id}><td>{u.full_name}</td><td>{u.email}</td>
              <td className="space-x-1">{u.role_names.map((r) => <Badge key={r} color="blue">{r}</Badge>)}</td></tr>))}</tbody></Table>
        )}
      </Card>
      <Card title="Invitations">
        <Table><thead><tr><th>Email</th><th>Role</th><th>Invited</th><th>Status</th></tr></thead>
          <tbody>{(invites.data ?? []).map((i) => (<tr key={i.id}><td>{i.email}{i.full_name && <div className="text-xs text-slate-500">{i.full_name}</div>}</td>
            <td>{i.roles?.name}</td><td>{dateTime(i.invited_at)}</td>
            <td><Badge color={i.claimed_at ? 'green' : i.revoked_at ? 'slate' : 'amber'}>{i.claimed_at ? 'Joined' : i.revoked_at ? 'Replaced' : 'Pending'}</Badge></td></tr>))}
            {invites.data?.length === 0 && <tr><td colSpan={4} className="text-slate-500">No invitations</td></tr>}</tbody></Table>
      </Card>
    </div>
  );
}
