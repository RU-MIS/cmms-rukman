'use client';
import { useState } from 'react';
import { must, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { Badge, Button, Card, ErrorBox, Input, PageHeader, Spinner, Table, useAction } from '@/components/ui';

interface Dept { id: string; name: string; is_active: boolean }

/** Departments of the users; the record scope "My department" shows documents created by colleagues of the same department. */
export default function DepartmentsPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const depts = useData(async () => must<Dept[]>(await sb().from('departments').select('id, name, is_active').eq('company_id', companyId).order('name')), [companyId]);
  const members = useData(async () => must<{ department_id: string | null }[]>(await sb().from('company_users').select('department_id').eq('company_id', companyId)), [companyId]);
  const [name, setName] = useState('');
  const [rename, setRename] = useState<Record<string, string>>({});
  const editable = can('users.edit');
  const count = (id: string) => (members.data ?? []).filter((m) => m.department_id === id).length;
  return (
    <div>
      <PageHeader title="Departments" subtitle="Assign users to a department in Users. Record scope “My department” is set per user or role." />
      <ErrorBox error={depts.error} />
      {editable && (
        <Card className="mb-4">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => {
            must(await sb().from('departments').insert({ company_id: companyId, name: name.trim() }));
            setName(''); depts.reload(); }, 'Department added'); }}>
            <Input aria-label="New department" placeholder="New department name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" busy={busy} disabled={!name.trim()}>Add</Button>
          </form>
        </Card>)}
      {!depts.data ? (depts.error ? null : <Spinner />) : (
        <Table><thead><tr><th>Department</th><th className="num">Users</th><th>Status</th><th /></tr></thead>
          <tbody>{depts.data.map((d) => (
            <tr key={d.id}>
              <td>{editable ? <Input aria-label={`Name ${d.name}`} value={rename[d.id] ?? d.name} onChange={(e) => setRename({ ...rename, [d.id]: e.target.value })} /> : d.name}</td>
              <td className="num">{count(d.id)}</td>
              <td><Badge color={d.is_active ? 'green' : 'slate'}>{d.is_active ? 'Active' : 'Inactive'}</Badge></td>
              <td className="whitespace-nowrap">{editable && <>
                {rename[d.id] !== undefined && rename[d.id] !== d.name && <Button variant="ghost" busy={busy} onClick={() => run(async () => {
                  must(await sb().from('departments').update({ name: rename[d.id].trim() }).eq('id', d.id));
                  setRename({}); depts.reload(); }, 'Renamed')}>Save</Button>}
                <Button variant="ghost" busy={busy} onClick={() => run(async () => {
                  must(await sb().from('departments').update({ is_active: !d.is_active }).eq('id', d.id)); depts.reload(); },
                  d.is_active ? 'Deactivated' : 'Activated')}>{d.is_active ? 'Deactivate' : 'Activate'}</Button></>}</td></tr>))}
            {depts.data.length === 0 && <tr><td colSpan={4} className="text-slate-500">No departments yet</td></tr>}</tbody></Table>)}
    </div>
  );
}
