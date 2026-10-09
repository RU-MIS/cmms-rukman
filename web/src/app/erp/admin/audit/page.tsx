'use client';
import { useState } from 'react';
import { must, rpc, sb } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { dateTime } from '@/lib/format';
import { downloadRows } from '@/lib/spreadsheet';
import { AuditDiff, type AuditRow } from '@/components/AuditTrail';
import { Badge, Button, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, useAction } from '@/components/ui';

const PAGE = 50;

/**
 * Audit viewer: rows the viewer may see (company, audit right, own data scope;
 * the Owner sees everything) with financial values masked per field right.
 */
export default function AuditPage() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { busy, run } = useAction();
  const [f, setF] = useState({ from: '', to: '', actor_id: '', table_name: '', action: '', row_id: '' });
  const [applied, setApplied] = useState(f);
  const [cursor, setCursor] = useState<(number | null)[]>([null]);
  const [sel, setSel] = useState<AuditRow | null>(null);
  const filters = Object.fromEntries(Object.entries(applied).filter(([, v]) => v));
  const page = useData(() => rpc<AuditRow[]>('audit_search', { p_company_id: companyId, p_filters: filters, p_limit: PAGE, p_before_id: cursor[cursor.length - 1] }),
    [companyId, JSON.stringify(applied), cursor.length]);
  const tables = useData(() => rpc<string[]>('audit_tables', { p_company_id: companyId }), [companyId]);
  const users = useData(async () => must<{ user_id: string; email: string }[]>(await sb().rpc('admin_users', { p_company_id: companyId }))
    .filter((u) => u.user_id), [companyId]);
  const apply = () => { setApplied(f); setCursor([null]); };
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Who changed what, when, from where. Values you may not see are shown as •••."
        actions={can('audit.export') && <Button variant="secondary" busy={busy} onClick={() => run(async () => {
          const rows = await rpc<AuditRow[]>('audit_export', { p_company_id: companyId, p_filters: filters });
          await downloadRows('audit-log', ['at', 'actor', 'action', 'table_name', 'row_id', 'ip', 'user_agent', 'old_data', 'new_data'],
            rows.map((r) => ({ ...r, ip: r.request_meta?.ip ?? '', user_agent: r.request_meta?.user_agent ?? '',
              old_data: r.old_data ? JSON.stringify(r.old_data) : '', new_data: r.new_data ? JSON.stringify(r.new_data) : '' })));
        }, 'Audit export ready')}>Export</Button>} />
      <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-3 lg:grid-cols-7">
        <Field label="From"><Input type="date" aria-label="From" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" aria-label="To" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="User"><Select aria-label="User" value={f.actor_id} placeholder="All users" onChange={(e) => setF({ ...f, actor_id: e.target.value })}
          options={(users.data ?? []).map((u) => ({ value: u.user_id, label: u.email }))} /></Field>
        <Field label="Area"><Select aria-label="Area" value={f.table_name} placeholder="All areas" onChange={(e) => setF({ ...f, table_name: e.target.value })}
          options={(tables.data ?? []).map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} /></Field>
        <Field label="Action"><Input aria-label="Action" placeholder="e.g. UPDATE" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} /></Field>
        <Field label="Record id"><Input aria-label="Record id" value={f.row_id} onChange={(e) => setF({ ...f, row_id: e.target.value.trim() })} /></Field>
        <div className="flex items-end gap-2"><Button onClick={apply}>Filter</Button>
          <Button variant="secondary" onClick={() => { const e = { from: '', to: '', actor_id: '', table_name: '', action: '', row_id: '' }; setF(e); setApplied(e); setCursor([null]); }}>Clear</Button></div>
      </div>
      <ErrorBox error={page.error} />
      {!page.data ? (page.error ? null : <Spinner />) : (
        <>
          <Table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Area</th><th>Record</th><th>IP</th><th /></tr></thead>
            <tbody>{page.data.map((r) => (
              <tr key={r.id} data-testid={`audit-${r.id}`}>
                <td className="whitespace-nowrap">{dateTime(r.at)}</td><td>{r.actor ?? 'system'}</td><td><Badge>{r.action}</Badge></td>
                <td>{r.table_name.replace(/_/g, ' ')}</td><td className="max-w-[10rem] truncate font-mono text-xs">{r.row_id}</td>
                <td className="text-xs">{r.request_meta?.ip ?? ''}</td>
                <td><Button variant="ghost" onClick={() => setSel(r)}>Details</Button></td></tr>))}
              {page.data.length === 0 && <tr><td colSpan={7} className="text-slate-500">No audit rows for this filter</td></tr>}</tbody></Table>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">Page {cursor.length}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={cursor.length <= 1} onClick={() => setCursor(cursor.slice(0, -1))}>Newer</Button>
              <Button variant="secondary" disabled={page.data.length < PAGE} onClick={() => setCursor([...cursor, page.data![page.data!.length - 1].id])}>Older</Button>
            </div>
          </div>
        </>)}
      {sel && <AuditDiff row={sel} onClose={() => setSel(null)} />}
    </div>
  );
}
