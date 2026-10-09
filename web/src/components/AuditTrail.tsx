'use client';
import { useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { dateTime, label } from '@/lib/format';
import { Badge, Button, Empty, Modal, Spinner, Table } from './ui';

export interface AuditRow { id: number; at: string; table_name: string; row_id: string | null; action: string; actor_id: string | null; actor: string | null;
  request_meta: { ip?: string; user_agent?: string } | null; old_data: unknown; new_data: unknown }

const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Side-by-side old / new values of one audit row (values masked by the database per field right). */
export function AuditDiff({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const o = (row.old_data && typeof row.old_data === 'object' ? row.old_data : {}) as Record<string, unknown>;
  const n = (row.new_data && typeof row.new_data === 'object' ? row.new_data : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].sort();
  const changed = keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
  const [all, setAll] = useState(false);
  return (
    <Modal open wide title={`${label(row.action)} · ${row.table_name} · ${dateTime(row.at)}`} onClose={onClose}>
      <p className="mb-2 text-sm text-slate-600">By <b>{row.actor ?? 'system'}</b>{row.request_meta?.ip ? ` · IP ${row.request_meta.ip}` : ''}
        {row.request_meta?.user_agent ? ` · ${row.request_meta.user_agent}` : ''}{row.row_id ? ` · record ${row.row_id}` : ''}</p>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show unchanged fields</label>
      <Table><thead><tr><th>Field</th><th>Old</th><th>New</th></tr></thead>
        <tbody>{(all ? keys : changed).map((k) => (
          <tr key={k}><td className="font-mono text-xs">{k}</td>
            <td className="max-w-xs break-all text-xs text-red-700">{show(o[k])}</td>
            <td className="max-w-xs break-all text-xs text-emerald-700">{show(n[k])}</td></tr>))}
          {(all ? keys : changed).length === 0 && <tr><td colSpan={3} className="text-slate-500">No field values recorded</td></tr>}</tbody></Table>
    </Modal>
  );
}

/** "Audit" tab of a record drawer (item, customer, vendor, godown, user, role). */
export function AuditTrail({ companyId, table, rowId }: { companyId: string; table: string; rowId: string }) {
  const rows = useData(() => rpc<AuditRow[]>('audit_search', { p_company_id: companyId, p_filters: { table_name: table, row_id: rowId }, p_limit: 100, p_before_id: null }),
    [companyId, table, rowId]);
  const [sel, setSel] = useState<AuditRow | null>(null);
  if (rows.error) return <Empty>{/permission|audit/i.test(rows.error) ? 'You cannot view the audit log.' : rows.error}</Empty>;
  if (!rows.data) return <Spinner />;
  if (rows.data.length === 0) return <Empty>No recorded changes.</Empty>;
  return (
    <>
      <Table><thead><tr><th>When</th><th>Action</th><th>By</th><th /></tr></thead>
        <tbody>{rows.data.map((r) => (
          <tr key={r.id}><td>{dateTime(r.at)}</td><td><Badge>{r.action}</Badge></td><td>{r.actor ?? 'system'}</td>
            <td><Button variant="ghost" onClick={() => setSel(r)}>Details</Button></td></tr>))}</tbody></Table>
      {sel && <AuditDiff row={sel} onClose={() => setSel(null)} />}
    </>
  );
}
