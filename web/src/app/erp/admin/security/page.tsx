'use client';
import Link from 'next/link';
import { rpc } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { dateTime } from '@/lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Table } from '@/components/ui';

interface Overview {
  users: { user_id: string; email: string; full_name: string | null; last_sign_in_at: string | null; must_change_password: boolean;
    temp_password_expired: boolean; status: string }[];
  recent_logins: { at: string; user_id: string; email: string | null; request_meta: { ip?: string; user_agent?: string } | null }[];
}

/** Security section: policy (Settings → Security) and the login overview. */
export default function SecurityPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const ov = useData(() => rpc<Overview>('login_overview', { p_company_id: companyId }), [companyId]);
  const pending = ov.data?.users.filter((u) => u.must_change_password) ?? [];
  const disabled = ov.data?.users.filter((u) => u.status !== 'ACTIVE') ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Security & logins" subtitle="Password policy, temporary passwords and recent sign-ins"
        actions={can('settings_security.view') && <Link className="text-sm text-brand hover:underline" href="/erp/admin/settings/?section=security">Password & session policy</Link>} />
      <Card title="What Supabase Auth enforces">
        <p className="text-sm text-slate-600">Sign-in rate limits, lockout after repeated failures and the minimum password length of the
          authentication service apply in addition to the company policy. Passwords are never stored or shown by the application.</p>
      </Card>
      <ErrorBox error={ov.error} />
      {!ov.data ? (ov.error ? null : <Spinner />) : <>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`Pending temporary passwords (${pending.length})`}>
            {pending.length === 0 ? <p className="text-sm text-slate-500">None</p> : <ul className="space-y-1 text-sm">{pending.map((u) => (
              <li key={u.user_id}>{u.email} {u.temp_password_expired ? <Badge color="red">expired</Badge> : <Badge color="amber">pending</Badge>}</li>))}</ul>}
          </Card>
          <Card title={`Disabled users (${disabled.length})`}>
            {disabled.length === 0 ? <p className="text-sm text-slate-500">None</p> : <ul className="space-y-1 text-sm">{disabled.map((u) => <li key={u.user_id}>{u.email}</li>)}</ul>}
          </Card>
        </div>
        <Card title="Last login per user">
          <Table><thead><tr><th>User</th><th>Name</th><th>Last sign-in</th><th>Status</th></tr></thead>
            <tbody>{ov.data.users.map((u) => (
              <tr key={u.user_id}><td>{u.email}</td><td>{u.full_name}</td><td>{u.last_sign_in_at ? dateTime(u.last_sign_in_at) : 'Never'}</td>
                <td><Badge color={u.status === 'ACTIVE' ? 'green' : 'slate'}>{u.status}</Badge></td></tr>))}</tbody></Table>
        </Card>
        <Card title="Recent sign-ins">
          <Table><thead><tr><th>When</th><th>User</th><th>IP address</th><th>Device / browser</th></tr></thead>
            <tbody>{ov.data.recent_logins.map((l, i) => (
              <tr key={i} data-testid="login-row"><td>{dateTime(l.at)}</td><td>{l.email}</td><td>{l.request_meta?.ip ?? '—'}</td>
                <td className="max-w-md truncate text-xs">{l.request_meta?.user_agent ?? '—'}</td></tr>))}
              {ov.data.recent_logins.length === 0 && <tr><td colSpan={4} className="text-slate-500">No sign-ins recorded yet</td></tr>}</tbody></Table>
        </Card>
      </>}
    </div>
  );
}
